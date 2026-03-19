console.log('[GList] personal-section mode content.js started.');

(() => {
  'use strict';

  const DEBUG = true;
  const log = (...args) => DEBUG && console.log('[GList]', ...args);

  const SECTION_ID = 'gchat-draft-personal-section';
  const CACHE_KEY = 'gchatDraftCacheV3';
  const ENABLED_KEY = 'gchatDraftFeatureEnabledV1';
  const CACHE_TTL_MS = 30 * 60 * 1000;
  const UPDATE_DEBOUNCE_MS = 300;

  let updateTimer = null;
  let isExpanded = false;
  let isUpdating = false;
  let featureEnabled = true;

  function startExtension() {
    try {
      log('Extension initialized. Version 3.1 (Better Identity + Navigation)');

      function normalizeName(name) {
        return (name || '')
          .replace(/下書き|Draft/gi, '')
          .replace(/未読メッセージ.*?件/g, '')
          .replace(/[\r\n]+/g, ' ')
          .replace(/\s+/g, ' ')
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
        featureEnabled = typeof stored === 'boolean' ? stored : true;
      }

      async function setFeatureEnabled(value) {
        featureEnabled = !!value;
        await storageSet(ENABLED_KEY, featureEnabled);
      }

      function inferKindFromElement(el) {
        if (!el) return 'unknown';

        const href =
          el.getAttribute?.('href') ||
          el.querySelector?.('a[href]')?.getAttribute('href') ||
          '';

        const itemId =
          el.getAttribute?.('data-item-id') ||
          el.closest?.('[data-item-id]')?.getAttribute('data-item-id') ||
          '';

        const blob = `${href} ${itemId}`.toLowerCase();

        if (blob.includes('/dm/') || blob.includes('dm:')) return 'dm';
        if (
          blob.includes('/space/') ||
          blob.includes('/room/') ||
          blob.includes('/spaces/') ||
          blob.includes('space:')
        ) {
          return 'space';
        }

        return 'unknown';
      }

      function extractHref(container) {
        if (!container) return '';

        const directHref = container.getAttribute?.('href');
        if (directHref) return directHref;

        const anchor = container.querySelector?.('a[href]');
        if (anchor) return anchor.getAttribute('href') || '';

        const closestAnchor = container.closest?.('a[href]');
        if (closestAnchor) return closestAnchor.getAttribute('href') || '';

        return '';
      }

      function extractItemId(container) {
        if (!container) return '';

        return (
          container.getAttribute?.('data-item-id') ||
          container.closest?.('[data-item-id]')?.getAttribute('data-item-id') ||
          ''
        );
      }

      function scoreNameCandidate(text) {
        if (!text) return -1;
        if (text.length > 80) return 1;
        if (text === '下書き' || text === 'Draft' || text === '[下書き]') return -1;
        if (/^\d{1,2}:\d{2}/.test(text)) return -1;
        if (/^\d+$/.test(text)) return -1;
        if (text.includes('未読') || text.includes('メッセージ')) return -1;
        return Math.min(100, text.length);
      }

      function extractBestName(container) {
        if (!container) return '';

        const candidates = [];

        const pushCandidate = (value, source) => {
          const normalized = normalizeName(value);
          if (!normalized) return;
          const score = scoreNameCandidate(normalized);
          if (score < 0) return;
          candidates.push({ value: normalized, score, source });
        };

        pushCandidate(container.getAttribute('aria-label'), 'container-aria');
        pushCandidate(container.getAttribute('title'), 'container-title');

        const anchor = container.querySelector('a[href]');
        if (anchor) {
          pushCandidate(anchor.getAttribute('aria-label'), 'anchor-aria');
          pushCandidate(anchor.getAttribute('title'), 'anchor-title');
          pushCandidate(textOf(anchor), 'anchor-text');
        }

        const richNodes = Array.from(
          container.querySelectorAll('span, div[dir="auto"], div[role="gridcell"], div')
        );

        for (const node of richNodes) {
          pushCandidate(node.getAttribute?.('aria-label'), 'node-aria');
          pushCandidate(node.getAttribute?.('title'), 'node-title');
          if (node.children.length === 0) {
            pushCandidate(textOf(node), 'leaf-text');
          }
        }

        pushCandidate(textOf(container), 'container-text');

        candidates.sort((a, b) => b.score - a.score);

        if (DEBUG && candidates.length > 0) {
          log('Name candidates:', candidates.slice(0, 5));
        }

        return candidates[0]?.value || '';
      }

      function extractAriaLabel(container) {
        if (!container) return '';
        return (
          container.getAttribute('aria-label') ||
          container.querySelector('a[href]')?.getAttribute('aria-label') ||
          ''
        );
      }

      function buildDraftRecord(container) {
        const name = extractBestName(container) || 'Unknown Chat';
        const href = extractHref(container);
        const itemId = extractItemId(container);
        const ariaLabel = extractAriaLabel(container);
        const kind = inferKindFromElement(container);

        return {
          name,
          href,
          itemId,
          ariaLabel,
          kind,
          element: container,
          cached: false
        };
      }

      function collectDraftItems() {
        const drafts = [];
        const seenKeys = new Set();

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
            '[role="listitem"], [role="treeitem"], [data-item-id], a[href], [jscontroller]'
          );

          if (!container) continue;

          const draft = buildDraftRecord(container);

          const key =
            draft.href ||
            draft.itemId ||
            `${draft.kind}:${draft.ariaLabel || draft.name}`;

          if (!seenKeys.has(key)) {
            drafts.push(draft);
            seenKeys.add(key);
          }
        }

        if (DEBUG) {
          log(
            'Collected drafts:',
            drafts.map((d) => ({
              name: d.name,
              href: d.href,
              itemId: d.itemId,
              kind: d.kind,
              ariaLabel: d.ariaLabel
            }))
          );
        }

        return drafts;
      }

      function makeCachePayload(drafts) {
        return {
          savedAt: Date.now(),
          items: drafts.map((d) => ({
            name: d.name,
            href: d.href,
            itemId: d.itemId,
            ariaLabel: d.ariaLabel,
            kind: d.kind
          }))
        };
      }

      async function loadCachedDrafts() {
        const payload = await storageGet(CACHE_KEY);
        if (!payload || !payload.savedAt || !Array.isArray(payload.items)) return [];

        const age = Date.now() - payload.savedAt;
        if (age > CACHE_TTL_MS) return [];

        return payload.items
          .map((item) => ({
            name: item.name || 'Unknown Chat',
            href: item.href || '',
            itemId: item.itemId || '',
            ariaLabel: item.ariaLabel || '',
            kind: item.kind || 'unknown',
            element: null,
            cached: true
          }))
          .filter((item) => item.name);
      }

      function mergeDrafts(liveDrafts, cachedDrafts) {
        const merged = [];
        const seen = new Set();

        const keyOf = (d) =>
          d.href || d.itemId || `${d.kind}:${d.ariaLabel || d.name}`;

        for (const d of liveDrafts) {
          const key = keyOf(d);
          if (!seen.has(key)) {
            merged.push(d);
            seen.add(key);
          }
        }

        for (const d of cachedDrafts) {
          const key = keyOf(d);
          if (!seen.has(key)) {
            merged.push(d);
            seen.add(key);
          }
        }

        return merged;
      }

      function clickElement(el) {
        if (!el) return false;
        const clickable = el.matches?.('a, button') ? el : el.querySelector?.('a, button') || el;
        clickable.click?.();
        return true;
      }

      function findByHref(href) {
        if (!href) return null;

        const exact = document.querySelector(`a[href="${CSS.escape(href)}"]`);
        if (exact) return exact;

        const anchors = Array.from(document.querySelectorAll('a[href]'));
        return anchors.find((a) => (a.getAttribute('href') || '').includes(href)) || null;
      }

      function findByItemId(itemId) {
        if (!itemId) return null;
        return document.querySelector(`[data-item-id="${CSS.escape(itemId)}"]`);
      }

      function findByAriaOrName(ariaLabel, name) {
        const candidates = Array.from(
          document.querySelectorAll('[role="listitem"], [role="treeitem"], a[href], [data-item-id]')
        );

        const targetName = normalizeName(name);
        const targetAria = normalizeName(ariaLabel);

        return (
          candidates.find((el) => {
            const label = normalizeName(
              el.getAttribute('aria-label') ||
              el.getAttribute('title') ||
              textOf(el)
            );

            if (!label) return false;
            if (targetAria && label.includes(targetAria)) return true;
            if (targetName && label.includes(targetName)) return true;
            return false;
          }) || null
        );
      }

      function resolveDraftTarget(draft) {
        if (draft.element && document.contains(draft.element)) {
          return draft.element;
        }

        const byHref = findByHref(draft.href);
        if (byHref) return byHref;

        const byItemId = findByItemId(draft.itemId);
        if (byItemId) return byItemId;

        const byLabel = findByAriaOrName(draft.ariaLabel, draft.name);
        if (byLabel) return byLabel;

        return null;
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

          if (width >= 160 && parentText.includes(textOf(heading))) {
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

                const target = resolveDraftTarget(draft);
                if (target) {
                  clickElement(target);
                  return;
                }

                alert(
                  `対象チャットを見つけられませんでした。\n\nname: ${draft.name}\nhref: ${draft.href || '(none)'}\nitemId: ${draft.itemId || '(none)'}`
                );
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
          log(
            'Section inserted:',
            target.reason,
            'live=',
            liveDrafts.length,
            'cached=',
            cachedDrafts.length,
            'enabled=',
            featureEnabled
          );
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
          attributeFilter: ['aria-label', 'title', 'class', 'href', 'data-item-id']
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
