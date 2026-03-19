console.log('[GList] sidebar mode content.js started.');

(() => {
  'use strict';

  const DEBUG = true;
  const log = (...args) => DEBUG && console.log('[GList]', ...args);

  const SECTION_ID = 'gchat-draft-sidebar-section';
  const CACHE_KEY = 'gchatDraftCacheV1';
  const CACHE_TTL_MS = 30 * 60 * 1000;
  const UPDATE_DEBOUNCE_MS = 300;

  let updateTimer = null;
  let isExpanded = true;
  let isUpdating = false;

  function startExtension() {
    try {
      log('Extension initialized. Version 2.1 (Shortcuts + Cache)');

      function normalizeName(name) {
        return (name || '')
          .replace(/下書き|Draft/gi, '')
          .replace(/未読メッセージ.*?件/g, '')
          .replace(/[\r\n]+/g, ' ')
          .trim();
      }

      function createPencilSvg() {
        const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        svg.setAttribute('viewBox', '0 0 24 24');
        svg.setAttribute('aria-hidden', 'true');

        const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        path.setAttribute(
          'd',
          'M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04c.39-.39.39-1.04 0-1.41l-2.34-2.34a.9959.9959 0 0 0-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z'
        );
        svg.appendChild(path);
        return svg;
      }

      function createChevronSvg(expanded) {
        const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        svg.setAttribute('viewBox', '0 0 24 24');
        svg.setAttribute('aria-hidden', 'true');
        svg.classList.add('gchat-draft-chevron-svg');
        if (expanded) svg.classList.add('expanded');

        const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        path.setAttribute('d', 'M7.41 8.59 12 13.17l4.59-4.58L18 10l-6 6-6-6z');
        svg.appendChild(path);
        return svg;
      }

      function textOf(el) {
        return (el?.textContent || '').trim();
      }

      function isShortcutHeadingText(text) {
        return text === 'ショートカット' || text === 'Shortcuts';
      }

      function collectDraftItems() {
        const drafts = [];
        const seenNames = new Set();

        const attrNodes = Array.from(
          document.querySelectorAll(
            '[aria-label*="下書き"], [aria-label*="Draft"], [title*="下書き"], [title*="Draft"]'
          )
        );

        const pathNodes = Array.from(document.querySelectorAll('svg path'));
        const iconNodes = pathNodes
          .filter((p) => {
            const d = p.getAttribute('d') || '';
            return d.includes('17.25V21h3.75') || d.includes('M3 17.25');
          })
          .map((p) => p.closest('svg'));

        const textNodes = Array.from(document.querySelectorAll('span, div')).filter((el) => {
          if (el.children.length > 0) return false;
          const text = textOf(el);
          return text === '下書き' || text === 'Draft' || text === '[下書き]';
        });

        const allIndicators = [...attrNodes, ...iconNodes, ...textNodes];

        for (const el of allIndicators) {
          if (!el || el.closest(`#${SECTION_ID}`)) continue;

          const container = el.closest(
            '[role="listitem"], [role="treeitem"], [data-item-id], a[href*="/dm/"], a[href*="/space/"], a, [jscontroller]'
          );

          if (!container) continue;

          let name =
            container.getAttribute('aria-label') ||
            container.getAttribute('title') ||
            '';

          name = normalizeName(name);

          if (!name || name.length > 60) {
            const spans = Array.from(container.querySelectorAll('span, div[dir="auto"]'));
            for (const span of spans) {
              const text = textOf(span);
              if (
                text &&
                text !== '下書き' &&
                text !== 'Draft' &&
                text !== '[下書き]' &&
                !/^\d{1,2}:\d{2}/.test(text)
              ) {
                name = normalizeName(text);
                break;
              }
            }
          }

          if (!name) name = 'Unknown Chat';
          name = name.trim();

          if (name && !seenNames.has(name)) {
            drafts.push({
              name,
              element: container,
              cached: false
            });
            seenNames.add(name);
          }
        }

        return drafts;
      }

      async function storageGet(key) {
        try {
          if (typeof chrome !== 'undefined' && chrome.storage?.local) {
            return await new Promise((resolve) => {
              chrome.storage.local.get([key], (result) => resolve(result?.[key]));
            });
          }
        } catch (err) {
          log('chrome.storage get failed, fallback to localStorage', err);
        }

        try {
          const raw = localStorage.getItem(key);
          return raw ? JSON.parse(raw) : null;
        } catch {
          return null;
        }
      }

      async function storageSet(key, value) {
        try {
          if (typeof chrome !== 'undefined' && chrome.storage?.local) {
            await new Promise((resolve) => {
              chrome.storage.local.set({ [key]: value }, () => resolve());
            });
            return;
          }
        } catch (err) {
          log('chrome.storage set failed, fallback to localStorage', err);
        }

        try {
          localStorage.setItem(key, JSON.stringify(value));
        } catch (err) {
          log('localStorage set failed', err);
        }
      }

      function makeCachePayload(drafts) {
        return {
          savedAt: Date.now(),
          items: drafts.map((d) => ({
            name: d.name
          }))
        };
      }

      async function loadCachedDrafts() {
        const payload = await storageGet(CACHE_KEY);
        if (!payload || !Array.isArray(payload.items) || !payload.savedAt) return [];

        const age = Date.now() - payload.savedAt;
        if (age > CACHE_TTL_MS) return [];

        return payload.items
          .map((item) => ({
            name: item.name,
            cached: true,
            element: null
          }))
          .filter((item) => item.name);
      }

      function mergeDrafts(liveDrafts, cachedDrafts) {
        const merged = [];
        const seen = new Set();

        for (const item of liveDrafts) {
          if (!seen.has(item.name)) {
            merged.push(item);
            seen.add(item.name);
          }
        }

        for (const item of cachedDrafts) {
          if (!seen.has(item.name)) {
            merged.push(item);
            seen.add(item.name);
          }
        }

        return merged;
      }

      function findLiveChatByName(name) {
        const candidates = Array.from(
          document.querySelectorAll('[role="listitem"], [role="treeitem"], a[href*="/dm/"], a[href*="/space/"], [data-item-id]')
        );

        return (
          candidates.find((el) => {
            const label = normalizeName(
              el.getAttribute('aria-label') ||
                el.getAttribute('title') ||
                textOf(el)
            );
            return label && label.includes(name);
          }) || null
        );
      }

      function createSection(drafts, meta = {}) {
        let section = document.getElementById(SECTION_ID);
        if (!section) {
          section = document.createElement('section');
          section.id = SECTION_ID;
          section.setAttribute('data-gchat-draft-sidebar', 'true');
        } else {
          section.innerHTML = '';
        }

        const header = document.createElement('button');
        header.type = 'button';
        header.className = 'gchat-draft-sidebar-header';

        const left = document.createElement('div');
        left.className = 'gchat-draft-sidebar-header-left';

        const iconWrap = document.createElement('span');
        iconWrap.className = 'gchat-draft-sidebar-icon';
        iconWrap.appendChild(createPencilSvg());

        const title = document.createElement('span');
        title.className = 'gchat-draft-sidebar-title';
        title.textContent = '下書き';

        left.appendChild(iconWrap);
        left.appendChild(title);

        const right = document.createElement('div');
        right.className = 'gchat-draft-sidebar-header-right';

        const count = document.createElement('span');
        count.className = 'gchat-draft-sidebar-count';
        count.textContent = String(drafts.length);

        const chevron = createChevronSvg(isExpanded);

        right.appendChild(count);
        right.appendChild(chevron);

        header.appendChild(left);
        header.appendChild(right);

        header.onclick = (e) => {
          e.stopPropagation();
          isExpanded = !isExpanded;
          scheduleUpdate();
        };

        section.appendChild(header);

        const body = document.createElement('div');
        body.className = 'gchat-draft-sidebar-body';
        if (isExpanded) body.classList.add('expanded');

        if (meta.usingCache) {
          const note = document.createElement('div');
          note.className = 'gchat-draft-cache-note';
          note.textContent = '保存済みの下書きを表示中';
          body.appendChild(note);
        }

        if (drafts.length === 0) {
          const empty = document.createElement('div');
          empty.className = 'gchat-draft-empty';
          empty.textContent = '未送信の下書きはありません';
          body.appendChild(empty);
        } else {
          const list = document.createElement('ul');
          list.className = 'gchat-draft-list';

          for (const draft of drafts) {
            const item = document.createElement('li');
            item.className = 'gchat-draft-list-item';

            const button = document.createElement('button');
            button.type = 'button';
            button.className = 'gchat-draft-list-button';
            button.title = draft.cached ? `${draft.name}（保存済み）` : draft.name;

            const dot = document.createElement('span');
            dot.className = 'gchat-draft-list-dot';

            const label = document.createElement('span');
            label.className = 'gchat-draft-list-label';
            label.textContent = draft.name;

            button.appendChild(dot);
            button.appendChild(label);

            if (draft.cached) {
              const tag = document.createElement('span');
              tag.className = 'gchat-draft-cached-tag';
              tag.textContent = '保存';
              button.appendChild(tag);
            }

            button.onclick = (e) => {
              e.stopPropagation();

              const target =
                draft.element ||
                findLiveChatByName(draft.name);

              if (target) {
                const clickable = target.querySelector('a') || target;
                clickable.click();
                return;
              }

              alert('この下書きは保存表示中ですが、現在の画面上で対象チャットを見つけられませんでした。');
            };

            item.appendChild(button);
            list.appendChild(item);
          }

          body.appendChild(list);
        }

        section.appendChild(body);

        return section;
      }

      function findShortcutsHeading() {
        const candidates = Array.from(document.querySelectorAll('span, div, h1, h2, h3, h4, h5'));
        return candidates.find((el) => isShortcutHeadingText(textOf(el))) || null;
      }

      function findShortcutSectionRoot(heading) {
        if (!heading) return null;

        let current = heading;
        for (let depth = 0; depth < 7 && current; depth += 1) {
          const parent = current.parentElement;
          if (!parent) break;

          const text = textOf(parent);
          const width = parent.offsetWidth;
          const height = parent.offsetHeight;

          const hasShortcutHeadingInside = text.includes('ショートカット') || text.includes('Shortcuts');
          const hasEnoughSize = width >= 180 && height >= 40;

          if (hasShortcutHeadingInside && hasEnoughSize) {
            current = parent;
          } else {
            break;
          }
        }

        return current instanceof HTMLElement ? current : null;
      }

      function findSidebarFallback() {
        const nav = document.querySelector('[role="navigation"]');
        if (nav instanceof HTMLElement) return nav;

        const candidates = Array.from(document.querySelectorAll('div')).filter((el) => {
          const width = el.offsetWidth;
          const height = el.offsetHeight;
          const text = textOf(el);
          return (
            width >= 180 &&
            width <= 500 &&
            height >= 200 &&
            (
              text.includes('ショートカット') ||
              text.includes('ホーム') ||
              text.includes('ダイレクト メッセージ') ||
              text.includes('スペース') ||
              text.includes('Shortcuts') ||
              text.includes('Home') ||
              text.includes('Direct messages') ||
              text.includes('Spaces')
            )
          );
        });

        return candidates[0] || null;
      }

      function findInsertionTarget() {
        const shortcutsHeading = findShortcutsHeading();
        if (shortcutsHeading) {
          const shortcutRoot = findShortcutSectionRoot(shortcutsHeading);
          if (shortcutRoot && shortcutRoot.parentElement) {
            return {
              type: 'afterend',
              element: shortcutRoot,
              reason: 'shortcuts-after'
            };
          }
        }

        const sidebar = findSidebarFallback();
        if (sidebar) {
          return {
            type: 'afterbegin',
            element: sidebar,
            reason: 'sidebar-fallback'
          };
        }

        return null;
      }

      function placeSection(target, section) {
        const existing = document.getElementById(SECTION_ID);

        if (
          existing &&
          existing.parentElement === target.element.parentElement &&
          target.type === 'afterend' &&
          existing.previousElementSibling === target.element
        ) {
          return;
        }

        if (
          existing &&
          existing.parentElement === target.element &&
          target.type === 'afterbegin' &&
          target.element.firstElementChild === existing
        ) {
          return;
        }

        target.element.insertAdjacentElement(target.type, section);
      }

      async function updateUI() {
        if (isUpdating) return;
        isUpdating = true;

        try {
          const liveDrafts = collectDraftItems();
          if (liveDrafts.length > 0) {
            await storageSet(CACHE_KEY, makeCachePayload(liveDrafts));
          }

          const cachedDrafts = await loadCachedDrafts();
          const drafts = mergeDrafts(liveDrafts, cachedDrafts);

          const section = createSection(drafts, {
            usingCache: liveDrafts.length === 0 && cachedDrafts.length > 0
          });

          const target = findInsertionTarget();
          if (!target) {
            log('Insertion target not found yet.');
            return;
          }

          placeSection(target, section);
          log('Section inserted:', target.reason, 'live=', liveDrafts.length, 'cached=', cachedDrafts.length);
        } catch (err) {
          console.error('[GList] updateUI failed:', err);
        } finally {
          isUpdating = false;
        }
      }

      function scheduleUpdate() {
        if (updateTimer) clearTimeout(updateTimer);
        updateTimer = setTimeout(() => {
          updateUI();
        }, UPDATE_DEBOUNCE_MS);
      }

      const observer = new MutationObserver((mutations) => {
        const internal = mutations.some((m) => {
          const node = m.target;
          return (
            node.id === SECTION_ID ||
            (node.closest && node.closest(`#${SECTION_ID}`))
          );
        });

        if (!internal) scheduleUpdate();
      });

      if (document.body) {
        observer.observe(document.body, {
          childList: true,
          subtree: true,
          attributes: true,
          attributeFilter: ['aria-label', 'title', 'class']
        });
      }

      updateUI();
    } catch (err) {
      console.error('[GList] CRITICAL ERROR:', err);
    }
  }

  if (document.body) {
    startExtension();
  } else {
    const bodyCheck = setInterval(() => {
      if (document.body) {
        clearInterval(bodyCheck);
        startExtension();
      }
    }, 100);
  }
})();
