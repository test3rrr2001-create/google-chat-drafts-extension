console.log('[GList] content.js execution started.');

(() => {
  'use strict';

  const DEBUG = true;
  const log = (...args) => DEBUG && console.log('[GList]', ...args);

  // ================================================================
  // ▼▼▼ 設定エリア ▼▼▼
  // ================================================================
  const SELECTORS = {
    chatListItem: [
      '[role="listitem"]',
      '[role="treeitem"]',
      'a[href*="/dm/"]',
      'a[href*="/space/"]',
      '[data-item-id]',
      '[data-grid-item-id]'
    ].join(','),

    draftIndicator: [
      '[aria-label*="Draft"]',
      '[aria-label*="下書き"]',
      '[title*="Draft"]',
      '[title*="下書き"]',
      'svg path[d*="M3 17.25V21h3.75"]', // Material Edit icon
    ].join(','),
  };

  const CONTAINER_ID = 'gchat-draft-list-container';
  const UPDATE_DEBOUNCE_MS = 200; // 高速化
  let updateTimer = null;
  let isExpanded = false; // 既定で閉じておく（競合防止）

  function startExtension() {
    try {
      log('Extension initialized. Version 1.2 (Robust Load)');

      // ----------------------------------------------------------------
      // 収集ロジック
      // ----------------------------------------------------------------

      function collectDraftItems() {
        const drafts = [];
        const seenNames = new Set();

        // ボトムアップ手法: まず「下書き」を示す可能性があるすべての要素を探す
        
        // A: 属性ベース (aria-label や title に下書きを含むもの)
        const attrNodes = Array.from(document.querySelectorAll(
          '[aria-label*="下書き"], [aria-label*="Draft"], [title*="下書き"], [title*="Draft"]'
        ));
        
        // B: アイコンベース (Googleの鉛筆アイコンのパス形状に合致するもの)
        const pathNodes = Array.from(document.querySelectorAll('svg path'));
        const iconNodes = pathNodes.filter(p => {
          const d = p.getAttribute('d') || '';
          return d.includes('17.25V21h3.75') || d.includes('M3 17.25');
        }).map(p => p.closest('svg'));

        // C: テキストベース (画面上に直接「下書き」と書かれている要素)
        const textNodes = Array.from(document.querySelectorAll('span, div')).filter(el => {
          // 子要素を持たない最下層のテキストノードだけを対象にする
          if (el.children.length > 0) return false;
          const text = el.textContent.trim();
          return text === '下書き' || text === 'Draft' || text === '[下書き]';
        });

        // すべての候補を結合
        const allIndicators = [...attrNodes, ...iconNodes, ...textNodes];

        for (const el of allIndicators) {
          if (!el || el.closest(`#${CONTAINER_ID}`)) continue;

          // 特徴要素から上に遡り、チャット項目のコンテナを探す
          const container = el.closest('[role="listitem"], [role="treeitem"], [data-item-id], a[href*="/dm/"], a[href*="/space/"], a, [jscontroller]');
          
          if (container) {
            // コンテナからチャット名になりそうな属性を取得
            let name = container.getAttribute('aria-label') || container.getAttribute('title') || '';
            
            // 下書きや未読表記などのノイズを取り除く
            name = name.replace(/下書き|Draft/ig, '')
                       .replace(/未読メッセージ.*?件/g, '')
                       .replace(/[\r\n]+/g, ' ')
                       .trim();
            
            // 属性からうまく名前が取れなかった場合は、中のテキスト要素を漁る
            if (!name || name.length > 50) {
              const spans = Array.from(container.querySelectorAll('span, div[dir="auto"]'));
              for (const span of spans) {
                const text = span.textContent.trim();
                // 時間、日付、下書きの文字以外で、最初の意味がある文字を名前にする
                if (text && text.length > 0 && text !== '下書き' && text !== 'Draft' && !/^\d{1,2}:\d{2}/.test(text)) {
                  name = text;
                  break; // 最初に見つけた名前を採用
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
        }
        return drafts;
      }


      // ----------------------------------------------------------------
      // UI 構築
      // ----------------------------------------------------------------

      function createPencilSvg() {
        const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        svg.setAttribute('viewBox', '0 0 24 24');
        const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        path.setAttribute('d', 'M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04c.39-.39.39-1.04 0-1.41l-2.34-2.34a.9959.9959 0 0 0-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z');
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

        const summary = document.createElement('div');
        summary.className = 'gchat-draft-summary-item';
        if (isExpanded) summary.classList.add('active');

        const icon = document.createElement('span');
        icon.className = 'gchat-draft-summary-icon';
        icon.appendChild(createPencilSvg());

        const text = document.createElement('span');
        text.className = 'gchat-draft-summary-text';
        text.textContent = '下書き';

        summary.appendChild(icon);
        summary.appendChild(text);

        // 下書きがある場合のみバッジを表示
        if (drafts.length > 0) {
          const badge = document.createElement('span');
          badge.className = 'gchat-draft-badge';
          badge.textContent = drafts.length;
          summary.appendChild(badge);
        }

        summary.onclick = (e) => {
          e.stopPropagation();
          isExpanded = !isExpanded;
          updateUI();
        };

        container.appendChild(summary);

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

      // ----------------------------------------------------------------
      // 挿入ロジック
      // ----------------------------------------------------------------

      function findTopBarInsertionPoint() {
        // 「後で見る (Saved)」ボタンを最優先の基準点とする
        const savedBtn = Array.from(document.querySelectorAll('button, [role="button"], a, [data-tooltip]'))
          .find(el => {
            const t = el.textContent || '';
            const a = el.getAttribute('aria-label') || '';
            const d = el.getAttribute('data-tooltip') || '';
            return t.includes('後で見る') || t.includes('Saved') || a.includes('Saved') || d.includes('Saved');
          });

        if (savedBtn) {
          // 【重要】ユーザー環境のコンテナが row-reverse（右から並ぶ設定）であると推測されるため、
          // 「左」に配置するには、DOM上では「後（afterend）」に挿入する必要があります。
          return { element: savedBtn, position: 'afterend' };
        }

        // 次点で「アクティブ」ボタンの前
        const activeBtn = Array.from(document.querySelectorAll('button, [role="button"]'))
          .find(el => {
            const t = el.textContent || '';
            const a = el.getAttribute('aria-label') || '';
            return t.includes('アクティブ') || t.includes('Active') || a.includes('Active');
          });

        if (activeBtn) {
          return { element: activeBtn, position: 'beforebegin' };
        }

        const topRight = document.querySelector('.GB_ie, .gb_ie, .X97S6e, [role="banner"] > div:last-child');
        if (topRight) return { element: topRight, position: 'afterbegin' };
        return null;
      }

      function updateUI() {
        const drafts = collectDraftItems();
        
        // 0件でも削除せず、UIをレンダリングする（常時表示）
        const ui = renderUI(drafts);
        const target = findTopBarInsertionPoint();
        
        if (target) {
          const existing = document.getElementById(CONTAINER_ID);
          if (!existing) {
            target.element.insertAdjacentElement(target.position, ui);
            log('UI inserted into header.');
          } else if (target.position === 'beforebegin' && existing.nextElementSibling !== target.element) {
            target.element.insertAdjacentElement(target.position, ui);
          } else if (target.position === 'afterend' && existing.previousElementSibling !== target.element) {
            target.element.insertAdjacentElement(target.position, ui);
          }
        } else {
          ui.style.position = 'fixed';
          ui.style.top = '12px';
          ui.style.right = '200px';
          ui.style.zIndex = '99999';
          if (!document.getElementById(CONTAINER_ID)) document.body.appendChild(ui);
        }
      }

      function scheduledUpdate() {
        if (updateTimer) clearTimeout(updateTimer);
        updateTimer = setTimeout(updateUI, UPDATE_DEBOUNCE_MS);
      }

      // ----------------------------------------------------------------
      // 監視
      // ----------------------------------------------------------------

      const observer = new MutationObserver((mutations) => {
        let internal = false;
        for (const m of mutations) {
          if (m.target.id === CONTAINER_ID || (m.target.closest && m.target.closest(`#${CONTAINER_ID}`))) {
            internal = true; break;
          }
        }
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

      // 即座に実行
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

  // ----------------------------------------------------------------
  // 起動制御
  // ----------------------------------------------------------------

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
