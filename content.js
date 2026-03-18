console.log('[GList] sidebar mode content.js started.');

(() => {
  'use strict';

  const DEBUG = true;
  const log = (...args) => DEBUG && console.log('[GList]', ...args);

  const SECTION_ID = 'gchat-draft-sidebar-section';
  const UPDATE_DEBOUNCE_MS = 250;

  let updateTimer = null;
  let isExpanded = true;

  function startExtension() {
    try {
      log('Extension initialized. Version 2.0 (Sidebar Mode)');

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
          const text = (el.textContent || '').trim();
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

          name = name
            .replace(/下書き|Draft/gi, '')
            .replace(/未読メッセージ.*?件/g, '')
            .replace(/[\r\n]+/g, ' ')
            .trim();

          if (!name || name.length > 60) {
            const spans = Array.from(container.querySelectorAll('span, div[dir="auto"]'));
            for (const span of spans) {
              const text = (span.textContent || '').trim();
              if (
                text &&
                text !== '下書き' &&
                text !== 'Draft' &&
                text !== '[下書き]' &&
                !/^\d{1,2}:\d{2}/.test(text)
              ) {
                name = text;
                break;
              }
            }
          }

          if (!name) name = 'Unknown Chat';
          name = name.trim();

          if (name && !seenNames.has(name)) {
            drafts.push({
              name,
              element: container
            });
            seenNames.add(name);
          }
        }

        return drafts;
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

      function createSection(drafts) {
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
          updateUI();
        };

        section.appendChild(header);

        const body = document.createElement('div');
        body.className = 'gchat-draft-sidebar-body';
        if (isExpanded) body.classList.add('expanded');

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
            button.title = draft.name;

            const dot = document.createElement('span');
            dot.className = 'gchat-draft-list-dot';

            const label = document.createElement('span');
            label.className = 'gchat-draft-list-label';
            label.textContent = draft.name;

            button.appendChild(dot);
            button.appendChild(label);

            button.onclick = (e) => {
              e.stopPropagation();
              const target = draft.element.querySelector('a') || draft.element;
              target.click();
            };

            item.appendChild(button);
            list.appendChild(item);
          }

          body.appendChild(list);
        }

        section.appendChild(body);

        return section;
      }

      function looksLikeSidebarContainer(el) {
        if (!el || !(el instanceof HTMLElement)) return false;
        if (el.closest(`#${SECTION_ID}`)) return false;

        const text = (el.textContent || '').trim();
        const style = window.getComputedStyle(el);

        if (style.display === 'none' || style.visibility === 'hidden') return false;
        if (el.offsetWidth < 180 || el.offsetHeight < 120) return false;

        const signals = [
          '[role="navigation"]',
          '[aria-label*="Chat"]',
          '[aria-label*="チャット"]',
          '[aria-label*="Spaces"]',
          '[aria-label*="スペース"]'
        ];

        if (signals.some((sel) => el.matches(sel))) return true;

        if (
          text.includes('ダイレクト メッセージ') ||
          text.includes('スペース') ||
          text.includes('Direct messages') ||
          text.includes('Spaces') ||
          text.includes('チャット')
        ) {
          return true;
        }

        return false;
      }

      function findSidebarInsertionPoint() {
        const directCandidates = [
          ...document.querySelectorAll('[role="navigation"]'),
          ...document.querySelectorAll('[aria-label*="チャット"], [aria-label*="Chat"]'),
          ...document.querySelectorAll('[aria-label*="ダイレクト"], [aria-label*="Direct"]'),
          ...document.querySelectorAll('[aria-label*="スペース"], [aria-label*="Spaces"]')
        ];

        for (const candidate of directCandidates) {
          if (looksLikeSidebarContainer(candidate)) {
            return { type: 'prepend', element: candidate, reason: 'direct-sidebar' };
          }

          const parent = candidate.closest('div');
          if (looksLikeSidebarContainer(parent)) {
            return { type: 'prepend', element: parent, reason: 'direct-parent' };
          }
        }

        const treeItems = Array.from(document.querySelectorAll('[role="treeitem"], [role="listitem"]'));
        for (const item of treeItems) {
          const text = (item.textContent || '').trim();
          if (
            text.includes('ダイレクト メッセージ') ||
            text.includes('スペース') ||
            text.includes('Direct messages') ||
            text.includes('Spaces')
          ) {
            let parent = item.parentElement;
            for (let i = 0; i < 6 && parent; i += 1) {
              if (parent.offsetWidth > 180 && parent.offsetHeight > 120) {
                return { type: 'prepend', element: parent, reason: 'tree-nearby' };
              }
              parent = parent.parentElement;
            }
          }
        }

        const wideDivs = Array.from(document.querySelectorAll('div')).filter((div) => {
          if (div.id === SECTION_ID) return false;
          if (div.querySelector(`#${SECTION_ID}`)) return false;
          if (div.offsetWidth < 180 || div.offsetWidth > 520) return false;
          if (div.offsetHeight < 150) return false;

          const text = (div.textContent || '').trim();
          return (
            text.includes('ダイレクト メッセージ') ||
            text.includes('スペース') ||
            text.includes('Direct messages') ||
            text.includes('Spaces')
          );
        });

        if (wideDivs.length > 0) {
          wideDivs.sort((a, b) => b.offsetHeight - a.offsetHeight);
          return { type: 'prepend', element: wideDivs[0], reason: 'wide-fallback' };
        }

        return null;
      }

      function placeSection(target, section) {
        const existing = document.getElementById(SECTION_ID);

        if (target.type === 'prepend') {
          if (
            existing &&
            existing.parentElement === target.element &&
            target.element.firstElementChild === existing
          ) {
            return;
          }
          target.element.insertAdjacentElement('afterbegin', section);
          return;
        }

        target.element.appendChild(section);
      }

      function updateUI() {
        const drafts = collectDraftItems();
        const section = createSection(drafts);
        const target = findSidebarInsertionPoint();

        if (!target) {
          log('Sidebar insertion point not found yet.');
          return;
        }

        placeSection(target, section);
        log('Sidebar section inserted.', target.reason, 'drafts=', drafts.length);
      }

      function scheduleUpdate() {
        if (updateTimer) clearTimeout(updateTimer);
        updateTimer = setTimeout(updateUI, UPDATE_DEBOUNCE_MS);
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
