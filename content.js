console.log('[GList] content.js execution started.');

(() => {
  'use strict';

  const DEBUG = true;
  const log = (...args) => DEBUG && console.log('[GList]', ...args);

  const CONTAINER_ID = 'gchat-draft-list-container';
  const UPDATE_DEBOUNCE_MS = 200;

  let updateTimer = null;
  let isExpanded = false;

  function startExtension() {
    try {
      log('Extension initialized. Version 1.6 (Compact Header Icon Mode)');

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
          if (!el || el.closest(`#${CONTAINER_ID}`)) continue;

          const container = el.closest(
            '[role="listitem"], [role="treeitem"], [data-item-id], a[href*="/dm/"], a[href*="/space/"], a, [jscontroller]'
          );

          if (!container) continue;

          let name = container.getAttribute('aria-label') || container.getAttribute('title') || '';
          name = name
            .replace(/下書き|Draft/gi, '')
            .replace(/未読メッセージ.*?件/g, '')
            .replace(/[\r\n]+/g, ' ')
            .trim();

          if (!name || name.length > 50) {
            const spans = Array.from(container.querySelectorAll('span, div[dir="auto"]'));
            for (const span of spans) {
              const text = (span.textContent || '').trim();
              if (
                text &&
                text !== '下書き' &&
                text !== 'Draft' &&
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
            drafts.push({ name, element: container });
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

      function renderUI(drafts) {
        let container = document.getElementById(CONTAINER_ID);
        if (!container) {
          container = document.createElement('div');
          container.id = CONTAINER_ID;
        } else {
          container.innerHTML = '';
        }

        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'gchat-draft-icon-button';
        button.setAttribute('aria-label', `下書き ${drafts.length}件`);
        button.setAttribute('title', drafts.length > 0 ? `下書き ${drafts.length}件` : '下書きなし');

        if (isExpanded) button.classList.add('active');

        const icon = document.createElement('span');
        icon.className = 'gchat-draft-icon';
        icon.appendChild(createPencilSvg());

        button.appendChild(icon);

        if (drafts.length > 0) {
          const badge = document.createElement('span');
          badge.className = 'gchat-draft-mini-badge';
          badge.textContent = drafts.length > 9 ? '9+' : String(drafts.length);
          button.appendChild(badge);
        }

        button.onclick = (e) => {
          e.stopPropagation();
          isExpanded = !isExpanded;
          updateUI();
        };

        container.appendChild(button);

        const list = document.createElement('ul');
        list.className = 'gchat-draft-expanded-list';
        if (isExpanded) list.classList.add('visible');

        if (drafts.length > 0) {
          for (const draft of drafts) {
            const li = document.createElement('li');
            li.className = 'gchat-draft-item';
            li.textContent = draft.name;
            li.onclick = (e) => {
              e.stopPropagation();
              const link = draft.element.querySelector('a') || draft.element;
              link.click();
            };
            list.appendChild(li);
          }
        } else {
          const li = document.createElement('li');
          li.className = 'gchat-draft-item empty';
          li.textContent = '下書きはありません';
          list.appendChild(li);
        }

        container.appendChild(list);
        return container;
      }

      function getFlexDirection(element) {
        if (!element) return 'row';
        return window.getComputedStyle(element).flexDirection || 'row';
      }

      function hardenHeaderLayout(referenceElement) {
        const parent = referenceElement?.parentElement;
        if (!parent) return;

        const style = window.getComputedStyle(parent);
        if (style.display.includes('flex')) {
          parent.style.setProperty('flex-wrap', 'nowrap', 'important');
          parent.style.setProperty('align-items', 'center', 'important');
          parent.style.setProperty('column-gap', '0px', 'important');
          parent.style.setProperty('row-gap', '0px', 'important');
        }
      }

      function isSavedButton(el) {
        if (!el) return false;
        const text = (el.textContent || '').trim();
        const aria = el.getAttribute('aria-label') || '';
        const tooltip = el.getAttribute('data-tooltip') || '';
        return (
          text.includes('後で見る') ||
          text.includes('Saved') ||
          aria.includes('後で見る') ||
          aria.includes('Saved') ||
          tooltip.includes('後で見る') ||
          tooltip.includes('Saved')
        );
      }

      function isActiveButton(el) {
        if (!el) return false;
        const text = (el.textContent || '').trim();
        const aria = el.getAttribute('aria-label') || '';
        return (
          text.includes('アクティブ') ||
          text.includes('Active') ||
          aria.includes('アクティブ') ||
          aria.includes('Active')
        );
      }

      function findTopBarInsertionPoint() {
        const candidates = Array.from(
          document.querySelectorAll('button, [role="button"], a, [data-tooltip]')
        );

        const savedBtn = candidates.find(isSavedButton);
        if (savedBtn) {
          const parent = savedBtn.parentElement;
          const direction = getFlexDirection(parent);
          hardenHeaderLayout(savedBtn);

          const position = direction === 'row-reverse' ? 'afterend' : 'beforebegin';
          return { element: savedBtn, position, parent, reason: 'saved-button' };
        }

        const activeBtn = candidates.find(isActiveButton);
        if (activeBtn) {
          const parent = activeBtn.parentElement;
          const direction = getFlexDirection(parent);
          hardenHeaderLayout(activeBtn);

          const position = direction === 'row-reverse' ? 'afterend' : 'beforebegin';
          return { element: activeBtn, position, parent, reason: 'active-button' };
        }

        const topRight = document.querySelector('.GB_ie, .gb_ie, .X97S6e, [role="banner"] > div:last-child');
        if (topRight) {
          topRight.style.setProperty('flex-wrap', 'nowrap', 'important');
          topRight.style.setProperty('align-items', 'center', 'important');
          return { element: topRight, position: 'afterbegin', parent: topRight, reason: 'fallback-container' };
        }

        return null;
      }

      function placeUi(target, ui) {
        const existing = document.getElementById(CONTAINER_ID);

        if (target.position === 'afterbegin') {
          if (!ui.parentElement || ui.parentElement !== target.element || target.element.firstElementChild !== ui) {
            target.element.insertAdjacentElement('afterbegin', ui);
          }
          return;
        }

        if (
          existing &&
          existing.parentElement === target.element.parentElement
        ) {
          if (target.position === 'beforebegin' && existing.nextElementSibling === target.element) return;
          if (target.position === 'afterend' && existing.previousElementSibling === target.element) return;
        }

        target.element.insertAdjacentElement(target.position, ui);
      }

      function updateUI() {
        const drafts = collectDraftItems();
        const ui = renderUI(drafts);
        const target = findTopBarInsertionPoint();

        if (target) {
          placeUi(target, ui);
          log('UI inserted into header.', target.reason, target.position);
          return;
        }

        ui.style.position = 'fixed';
        ui.style.top = '12px';
        ui.style.right = '180px';
        ui.style.zIndex = '99999';

        if (!document.getElementById(CONTAINER_ID)) {
          document.body.appendChild(ui);
        }
      }

      function scheduledUpdate() {
        if (updateTimer) clearTimeout(updateTimer);
        updateTimer = setTimeout(updateUI, UPDATE_DEBOUNCE_MS);
      }

      const observer = new MutationObserver((mutations) => {
        const internal = mutations.some((m) => {
          const target = m.target;
          return target.id === CONTAINER_ID || (target.closest && target.closest(`#${CONTAINER_ID}`));
        });

        if (!internal) scheduledUpdate();
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

      document.addEventListener('click', (e) => {
        if (isExpanded && !e.target.closest(`#${CONTAINER_ID}`)) {
          isExpanded = false;
          updateUI();
        }
      });
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
