console.log('[GList] personal-section mode content.js started.');

(() => {
  'use strict';

  const DEBUG = true;
  const log = (...args) => DEBUG && console.log('[GList]', ...args);

  const SECTION_ID = 'gchat-draft-personal-section';
  const CACHE_KEY = 'gchatDraftCacheV2';
  const ENABLED_KEY = 'gchatDraftFeatureEnabledV1';
  const CACHE_TTL_MS = 30 * 60 * 1000;
  const UPDATE_DEBOUNCE_MS = 300;

  let updateTimer = null;
  let isExpanded = false;
  let isUpdating = false;
  let featureEnabled = true;

  function startExtension() {
    try {
      log('Extension initialized. Version 3.0 (Personal Section Top + Toggle)');

      function normalizeName(name) {
        return (name || '')
          .replace(/下書き|Draft/gi, '')
          .replace(/未読メッセージ.*?件/g, '')
          .replace(/[\r\n]+/g, ' ')
          .trim();
      }

      function textOf(el) {
        return (el?.textContent || '').trim();
      }

      function createSvg(pathD, className = '') {
        const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        svg.setAttribute('viewBox', '0 0 24 24');
        svg.setAttribute('aria-hidden', 'true');
        if (className) svg.setAttribute('class', className);

        const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        path.setAttribute('d', pathD);
        svg.appendChild(path);

        return svg;
      }

      function createPencilSvg() {
        return createSvg(
          'M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04c.39-.39.39-1.04 0-1.41l-2.34-2.34a.9959.9959 0 0 0-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z'
        );
      }

      function createChevronSvg(expanded) {
        const svg = createSvg('M7.41 8.59 12 13.17l4.59-4.58L18 10l-6 6-6-6z', 'gchat-draft-chevron-svg');
        if (expanded) svg.classList.add('expanded');
        return svg;
      }

      async function storageGet(key) {
        try {
          if (typeof chrome !== 'undefined' && chrome.storage?.local) {
            return await new Promise((resolve) => {
              chrome.storage.local.get([key], (result) => resolve(result?.[key]));
            });
          }
        } catch (err) {
          log('chrome.storage get failed, fallback localStorage', err);
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
          log('chrome.storage set failed, fallback localStorage', err);
        }

        try {
          localStorage.setItem(key, JSON.stringify(value));
        } catch (err) {
          log('localStorage set failed', err);
        }
      }

      async function loadFeatureEnabled() {
        const stored = await storageGet(ENABLED_KEY);
        if (typeof stored === 'boolean') {
          featureEnabled = stored;
        } else {
          featureEnabled = true;
        }
      }

      async function setFeatureEnabled(value) {
        featureEnabled = !!value;
        await storageSet(ENABLED_KEY, featureEnabled);
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

      function makeCachePayload(drafts) {
        return {
          savedAt: Date.now(),
          items: drafts.map((d) => ({ name: d.name }))
        };
      }

      async function loadCachedDrafts() {
        const payload = await storageGet(CACHE_KEY);
        if (!payload || !payload.savedAt || !Array.isArray(payload.items)) return [];

        const age = Date.now() - payload.savedAt;
        if (age > CACHE_TTL_MS) return [];

        return payload.items
          .map((item) => ({
            name: item.name,
            element: null,
            cached: true
          }))
          .filter((item) => item.name);
      }

      function mergeDrafts(liveDrafts, cachedDrafts) {
        const merged = [];
        const seen = new Set();

        for (const draft of liveDrafts) {
          if (!seen.has(draft.name)) {
            merged.push(draft);
            seen.add(draft.name);
          }
        }

        for (const draft of cachedDrafts) {
          if (!seen.has(draft.name)) {
            merged.push(draft);
            seen.add(draft.name);
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

      function isPersonalHeading(text) {
        return text === '自分専用' || text === 'Personal' || text === 'Assigned to me';
      }

      function findPersonalHeading() {
        const nodes = Array.from(document.querySelectorAll('span, div, h1, h2, h3, h4, h5'));
        return nodes.find((el) => isPersonalHeading(textOf(el))) || null;
      }

      function findHeaderRowForHeading(heading) {
        if (!heading) return null;

        let current = heading;
        for (let i = 0; i < 6 && current; i += 1) {
          const parent = current.parentElement;
          if (!parent) break;

          const parentText = textOf(parent);
          const width = parent.offsetWidth;

          if (
            width >= 160 &&
            parentText.includes(textOf(heading))
          ) {
            current = parent;
          } else {
            break;
          }
        }

        return current instanceof HTMLElement ? current : null;
      }

      function findPersonalInsertionTarget() {
        const heading = findPersonalHeading();
        if (heading) {
          const headerRow = findHeaderRowForHeading(heading);
          if (headerRow?.parentElement) {
            return {
              type: 'afterend',
              element: headerRow,
              reason: 'personal-header-after'
            };
          }
        }

        const nav = document.querySelector('[role="navigation"]');
        if (nav instanceof HTMLElement) {
          return {
            type: 'afterbegin',
            element: nav,
            reason: 'navigation-fallback'
          };
        }

        return null;
      }

      function createToggle(enabled) {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'gchat-draft-toggle';
        if (enabled) button.classList.add('enabled');
        button.setAttribute('aria-label', enabled ? '下書き機能 ON' : '下書き機能 OFF');
        button.setAttribute('title', enabled ? '下書き機能 ON' : '下書き機能 OFF');

        const knob = document.createElement('span');
        knob.className = 'gchat-draft-toggle-knob';

        button.appendChild(knob);
        return button;
      }

      function createSection(drafts, meta = {}) {
        let section = document.getElementById(SECTION_ID);
        if (!section) {
          section = document.createElement('section');
          section.id = SECTION_ID;
          section.setAttribute('data-gchat-draft-personal', 'true');
        } else {
          section.innerHTML = '';
        }

        if (!featureEnabled) {
          isExpanded = false;
        }

        const row = document.createElement('div');
        row.className = 'gchat-draft-row';
        if (!featureEnabled) row.classList.add('disabled');

        const mainButton = document.createElement('button');
        mainButton.type = 'button';
        mainButton.className = 'gchat-draft-row-main';

        const icon = document.createElement('span');
        icon.className = 'gchat-draft-row-icon';
        icon.appendChild(createPencilSvg());

        const labelWrap = document.createElement('div');
        labelWrap.className = 'gchat-draft-row-label-wrap';

        const title = document.createElement('div');
        title.className = 'gchat-draft-row-title';
        title.textContent = '下書き';

        const subtitle = document.createElement('div');
        subtitle.className = 'gchat-draft-row-subtitle';

        if (!featureEnabled) {
          subtitle.textContent = 'OFF';
        } else if (meta.usingCache) {
          subtitle.textContent = '保存済みを表示中';
        } else {
          subtitle.textContent = drafts.length > 0 ? `${drafts.length}件の下書き` : '下書きなし';
        }

        labelWrap.appendChild(title);
        labelWrap.appendChild(subtitle);

        const right = document.createElement('div');
        right.className = 'gchat-draft-row-right';

        if (featureEnabled) {
          const badge = document.createElement('span');
          badge.className = 'gchat-draft-row-badge';
          badge.textContent = String(drafts.length);
          right.appendChild(badge);
        }

        const chevron = createChevronSvg(featureEnabled && isExpanded);
        right.appendChild(chevron);

        mainButton.appendChild(icon);
        mainButton.appendChild(labelWrap);
        mainButton.appendChild(right);

        mainButton.onclick = (e) => {
          e.stopPropagation();
          if (!featureEnabled) return;
          isExpanded = !isExpanded;
          scheduleUpdate();
        };

        const toggle = createToggle(featureEnabled);
        toggle.onclick = async (e) => {
          e.stopPropagation();
          await setFeatureEnabled(!featureEnabled);
          scheduleUpdate();
        };

        row.appendChild(mainButton);
        row.appendChild(toggle);
        section.appendChild(row);

        const body = document.createElement('div');
        body.className = 'gchat-draft-panel';
        if (featureEnabled && isExpanded) body.classList.add('expanded');

        if (featureEnabled) {
          if (drafts.length === 0) {
            const empty = document.createElement('div');
            empty.className = 'gchat-draft-empty';
            empty.textContent = '未送信の下書きはありません';
            body.appendChild(empty);
          } else {
            const list = document.createElement('ul');
            list.className = 'gchat-draft-list';

            for (const draft of drafts) {
              const li = document.createElement('li');
              li.className = 'gchat-draft-list-item';

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

                const target = draft.element || findLiveChatByName(draft.name);
                if (target) {
                  const clickable = target.querySelector('a') || target;
                  clickable.click();
                  return;
                }

                alert('保存済み下書きはありますが、現在の画面上で対象チャットを見つけられませんでした。');
              };

              li.appendChild(button);
              list.appendChild(li);
            }

            body.appendChild(list);
          }
        } else {
          const note = document.createElement('div');
          note.className = 'gchat-draft-empty';
          note.textContent = '下書き機能は OFF です';
          body.appendChild(note);
        }

        section.appendChild(body);

        return section;
      }

      function placeSection(target, section) {
        const existing = document.getElementById(SECTION_ID);

        if (
          existing &&
          target.type === 'afterend' &&
          existing.previousElementSibling === target.element
        ) {
          return;
        }

        if (
          existing &&
          target.type === 'afterbegin' &&
          existing.parentElement === target.element &&
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
          await loadFeatureEnabled();

          const liveDrafts = collectDraftItems();
          if (liveDrafts.length > 0) {
            await storageSet(CACHE_KEY, makeCachePayload(liveDrafts));
          }

          const cachedDrafts = await loadCachedDrafts();
          const drafts = mergeDrafts(liveDrafts, cachedDrafts);

          const section = createSection(drafts, {
            usingCache: liveDrafts.length === 0 && cachedDrafts.length > 0
          });

          const target = findPersonalInsertionTarget();
          if (!target) {
            log('Personal insertion target not found yet.');
            return;
          }

          placeSection(target, section);
          log('Section inserted:', target.reason, 'drafts=', drafts.length, 'enabled=', featureEnabled);
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
