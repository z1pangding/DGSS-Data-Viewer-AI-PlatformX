document.addEventListener('DOMContentLoaded', () => {
    const aiStatusDot = document.getElementById('aiStatusDot');
    const aiPanel = document.getElementById('aiPanel');
    const modelSelect = document.getElementById('modelSelect');
    const chatInput = document.getElementById('chatInput');
    const sendBtn = document.getElementById('sendBtn');
    const chatContainer = document.getElementById('chatContainer');

    let ollamaAvailable = false;

    // Check Status
    function checkStatus() {
        fetch('/api/ollama/status')
            .then(response => response.json())
            .then(data => {
                ollamaAvailable = data.available;
                if (ollamaAvailable) {
                    aiStatusDot.classList.add('online');
                    aiStatusDot.title = "Ollama 在线";
                    enableAIInterface(true);
                    loadModels();
                } else {
                    aiStatusDot.classList.remove('online');
                    aiStatusDot.title = "Ollama 离线";
                    if (modelSelect) {
                        modelSelect.innerHTML = '<option>Ollama 服务未启动</option>';
                    }
                    enableAIInterface(false);
                }
            })
            .catch(err => {
                console.error('Error checking Ollama status:', err);
                if (modelSelect) {
                    modelSelect.innerHTML = '<option>连接超时</option>';
                }
                enableAIInterface(false);
            });
    }

    // Poll every 5 seconds
    setInterval(checkStatus, 5000);

    function enableAIInterface(enabled) {
        if (modelSelect) modelSelect.disabled = !enabled;
        if (chatInput) chatInput.disabled = !enabled;
        if (sendBtn) sendBtn.disabled = !enabled;
        if (!enabled && aiPanel) {
            aiPanel.style.opacity = '0.7';
        } else if (aiPanel) {
            aiPanel.style.opacity = '1';
        }
    }

    function loadModels() {
        if (!modelSelect) return;

        fetch('/api/ollama/models')
            .then(response => response.json())
            .then(data => {
                if (data.models) {
                    modelSelect.innerHTML = '';
                    data.models.forEach(model => {
                        const option = document.createElement('option');
                        option.value = model;
                        option.textContent = model;
                        modelSelect.appendChild(option);
                    });

                    // Restore saved selection
                    const savedModel = localStorage.getItem('selected_model');
                    if (savedModel && data.models.includes(savedModel)) {
                        modelSelect.value = savedModel;
                    }
                }
            });
    }

    function appendSystemMessage(text) {
        if (!chatContainer) return;
        const div = document.createElement('div');
        div.className = 'message ai system';
        div.textContent = text;
        chatContainer.appendChild(div);
        chatContainer.scrollTop = chatContainer.scrollHeight;
    }

    if (modelSelect) {
        modelSelect.addEventListener('change', () => {
            localStorage.setItem('selected_model', modelSelect.value);
        });
    }

    // Toggle Button Logic
    const toggleAiBtn = document.getElementById('toggleAiBtn');
    if (toggleAiBtn && aiPanel) {
        toggleAiBtn.addEventListener('click', () => {
            aiPanel.classList.toggle('collapsed');
            const isCollapsed = aiPanel.classList.contains('collapsed');
            localStorage.setItem('ai_panel_collapsed', isCollapsed);
        });

        // Restore state
        const savedState = localStorage.getItem('ai_panel_collapsed');
        if (savedState === 'true') {
            aiPanel.classList.add('collapsed');
        }
    }

    // Chat Logic
    async function sendQuery() {
        const text = chatInput.value.trim();
        if (!text) return;

        const model = modelSelect.value;
        if (!model) {
            alert("请先选择模型");
            return;
        }

        appendMessage('user', text);
        chatInput.value = '';
        chatInput.style.height = 'auto';

        let context = {};
        if (window.getDGSSContext) {
            context = window.getDGSSContext();
        }

        const aiMsgDiv = appendMessage('ai', '');
        const thinkingDiv = document.createElement('div');
        thinkingDiv.className = 'thought-block';
        thinkingDiv.style.display = 'none';
        aiMsgDiv.appendChild(thinkingDiv);

        const contentDiv = document.createElement('div');
        aiMsgDiv.appendChild(contentDiv);

        let fullResponse = "";
        let isThinking = false;

        try {
            const response = await fetch('/api/ollama/query', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    model: model,
                    prompt: text,
                    context: context
                })
            });

            const reader = response.body.getReader();
            const decoder = new TextDecoder();

            while (true) {
                const { done, value } = await reader.read();
                if (done) break;

                const chunk = decoder.decode(value, { stream: true });
                fullResponse += chunk;

                if (chunk.includes('<thought>')) {
                    isThinking = true;
                    thinkingDiv.style.display = 'none';
                }

                if (chunk.includes('</thought>')) {
                    isThinking = false;
                }

                let displayChunk = chunk;
                if (isThinking) {
                    displayChunk = "";
                } else if (chunk.includes('</thought>')) {
                    displayChunk = chunk.split('</thought>')[1] || "";
                } else if (chunk.includes('<thought>')) {
                    displayChunk = chunk.split('<thought>')[0] || "";
                }

                contentDiv.innerText += displayChunk;
                chatContainer.scrollTop = chatContainer.scrollHeight;
            }

            const jsonMatch = fullResponse.match(/\{[\s\S]*"actions"[\s\S]*\}/);
            if (jsonMatch) {
                try {
                    let jsonStr = jsonMatch[0];
                    const actionPlan = JSON.parse(jsonStr);
                    if (actionPlan.actions && actionPlan.actions.length > 0) {
                        contentDiv.appendChild(createConfirmationCard(actionPlan.actions, context.filePath));
                        chatContainer.scrollTop = chatContainer.scrollHeight;
                    }
                } catch (e) {
                    console.log("JSON parsing error ignored:", e);
                }
            }

        } catch (err) {
            contentDiv.innerText += `\n[Error: ${err.message}]`;
        }
    }

    function createConfirmationCard(actions, filePath) {
        const card = document.createElement('div');
        card.className = 'confirmation-card';

        const title = document.createElement('div');
        title.className = 'card-title';

        const isSearch = actions.every(a => a.type === 'SEARCH');
        const titleText = isSearch ? '数据查询请求' : '建议修改操作';
        title.innerHTML = `<span>${titleText}</span> <span>${actions.length} 项</span>`;
        card.appendChild(title);

        const list = document.createElement('div');
        list.className = 'action-list';

        actions.forEach(action => {
            const item = document.createElement('div');
            item.className = 'action-item';

            const badge = document.createElement('span');
            badge.className = `action-badge badge-${action.type}`;
            badge.textContent = action.type;

            const details = document.createElement('span');
            details.className = 'action-details';

            let detailText = `${action.table}`;
            if (action.id) detailText += ` #${action.id}`;
            if (action.data) {
                const keys = Object.keys(action.data);
                const changes = keys.map(k => `${k}=${action.data[k]}`).join(', ');
                detailText += ` : ${changes}`;
            } else if (action.filter) {
                const keys = Object.keys(action.filter);
                const filters = keys.map(k => `${k}=${action.filter[k]}`).join(', ');
                detailText += ` (Filter: ${filters})`;
            }
            details.textContent = detailText;
            details.title = detailText;

            item.appendChild(badge);
            item.appendChild(details);
            list.appendChild(item);
        });
        card.appendChild(list);

        const btnContainer = document.createElement('div');
        btnContainer.className = 'card-actions';

        const confirmBtn = document.createElement('button');
        confirmBtn.className = 'btn-confirm';
        confirmBtn.textContent = actions.every(a => a.type === 'SEARCH') ? '开始查询' : '确认执行';

        const cancelBtn = document.createElement('button');
        cancelBtn.className = 'btn-cancel';
        cancelBtn.textContent = '取消';

        confirmBtn.onclick = () => {
            confirmBtn.disabled = true;
            cancelBtn.disabled = true;
            confirmBtn.textContent = '执行中...';
            executeActions(actions, filePath, card);
        };

        cancelBtn.onclick = () => {
            card.remove();
        };

        btnContainer.appendChild(cancelBtn);
        btnContainer.appendChild(confirmBtn);
        card.appendChild(btnContainer);

        return card;
    }

    async function executeActions(actions, filePath, cardElement) {
        try {
            const response = await fetch('/api/ollama/execute', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    actions: actions,
                    filePath: filePath
                })
            });

            const result = await response.json();

            if (response.ok && result.success) {
                let msg = "";

                const isSearch = actions.some(a => a.type === 'SEARCH');

                // Case: Search Results
                if (isSearch) {
                    if (result.search_results && result.search_results.length > 0) {
                        msg += `<div style="color:#333; padding:5px;">
                            <div>✅ 找到 ${result.search_results.length} 条数据:</div>
                            <div style="max-height:300px; overflow:auto; margin-top:5px; border:1px solid #eee; background:#f9f9f9; padding:8px; font-family:monospace; font-size:12px; white-space:pre-wrap;">`;

                        // Render as text list
                        result.search_results.forEach((row, index) => {
                            msg += `[${index + 1}] `;
                            if (row._source) msg += `(Source: ${row._source}) `;

                            // Format remaining keys
                            const details = Object.entries(row)
                                .filter(([k]) => k !== '_source')
                                .map(([k, v]) => `${k}=${v}`)
                                .join(', ');

                            msg += details + "\n";
                        });

                        msg += `</div></div>`;
                    } else {
                        msg += `<div style="color:#666; text-align:center; padding:10px;">
                            ⚠️ 未找到符合条件的数据。
                        </div>`;
                    }
                }
                // Case: Updates/Inserts
                else if (result.count !== undefined) {
                    msg += `<div style="color:green; text-align:center; padding:10px;">
                        ✅ 执行成功! 修改了 ${result.count} 条记录。<br>
                        <small>请刷新数据查看更新。</small>
                    </div>`;
                }

                if (result.debug && result.debug.length > 0) {
                    msg += `<div style="margin-top:10px; font-size:11px; color:#666; background:#f5f5f5; padding:5px; border-radius:4px; max-height:100px; overflow-y:auto;">
                        <strong>调试日志:</strong><br>
                        ${result.debug.join('<br>')}
                    </div>`;
                }
                cardElement.innerHTML = msg;
            } else {
                let errorMsg = result.error || 'Unknown error';
                if (result.debug && result.debug.length > 0) {
                    errorMsg += `<br><br><small>调试信息:<br>${result.debug.join('<br>')}</small>`;
                }
                throw new Error(errorMsg);
            }
        } catch (error) {
            alert('执行失败: ' + error.message);
            const btn = cardElement.querySelector('.btn-confirm');
            if (btn) {
                btn.disabled = false;
                btn.textContent = '重试';
            }
            const cancel = cardElement.querySelector('.btn-cancel');
            if (cancel) cancel.disabled = false;
        }
    }

    function appendMessage(role, text) {
        const div = document.createElement('div');
        div.className = `message ${role}`;
        div.innerText = text;
        chatContainer.appendChild(div);
        chatContainer.scrollTop = chatContainer.scrollHeight;
        return div;
    }

    if (sendBtn) {
        sendBtn.addEventListener('click', sendQuery);
    }

    if (chatInput) {
        chatInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                sendQuery();
            }
        });

        chatInput.addEventListener('input', function () {
            this.style.height = 'auto';
            this.style.height = (this.scrollHeight) + 'px';
        });
    }

    // Initial check
    checkStatus();
});
