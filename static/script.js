document.addEventListener('DOMContentLoaded', () => {
    const folderPathInput = document.getElementById('folderPath');
    const scanBtn = document.getElementById('scanBtn');
    const browseBtn = document.getElementById('browseBtn');
    const themeToggle = document.getElementById('themeToggle');
    const fileList = document.getElementById('fileList');
    const dataContainer = document.getElementById('dataContainer');
    const fileNameDisplay = document.getElementById('fileName');
    const tableListDisplay = document.getElementById('tableList');
    const statusDisplay = document.getElementById('status');
    const saveBtn = document.getElementById('saveBtn');
    const tabGeological = document.getElementById('tabGeological');
    const tabRawFiles = document.getElementById('tabRawFiles');

    window.getDGSSContext = function () {
        if (!currentFile) return null;

        const context = {
            filePath: currentFile.path,
            tableName: currentTable,
            routeCode: null,
            geoPoint: null
        };

        // Try to find selected row/cell to extract precise context
        const selectedCell = document.querySelector('td.selected') || document.activeElement;
        if (selectedCell && selectedCell.tagName === 'TD') {
            const tr = selectedCell.parentElement;

            // Try to find ROUTECODE column
            const routeCell = Array.from(tr.children).find(td =>
                td.dataset.column && td.dataset.column.toUpperCase() === 'ROUTECODE'
            );
            if (routeCell) context.routeCode = routeCell.textContent;

            // Try to find GEOPOINT column
            const pointCell = Array.from(tr.children).find(td =>
                td.dataset.column && td.dataset.column.toUpperCase() === 'GEOPOINT'
            );
            if (pointCell) context.geoPoint = pointCell.textContent;
        }

        return context;
    };

    let currentFile = null;
    let currentTable = null;
    let pendingChanges = {}; // Map of rowId -> { col: newVal }
    let currentTab = 'geological'; // 'geological' or 'raw'
    let rawFilesCache = [];
    let geologicalDataCache = {};

    // 标签页相关变量
    let tabs = [];
    let currentTabIndex = -1;
    const tabsContainer = document.getElementById('tabsContainer');
    const tabsList = document.getElementById('tabsList');

    // Theme Management
    const savedTheme = localStorage.getItem('dgss_theme') || 'dark';
    document.documentElement.setAttribute('data-theme', savedTheme);

    themeToggle.addEventListener('click', () => {
        const currentTheme = document.documentElement.getAttribute('data-theme');
        const newTheme = currentTheme === 'light' ? 'dark' : 'light';
        document.documentElement.setAttribute('data-theme', newTheme);
        localStorage.setItem('dgss_theme', newTheme);
    });

    // Load last used path from localStorage
    const savedPath = localStorage.getItem('dgss_last_path');
    if (savedPath) {
        folderPathInput.value = savedPath;
    }

    browseBtn.addEventListener('click', async () => {
        try {
            const response = await fetch('/api/select-folder', { method: 'POST' });
            const data = await response.json();
            if (data.path) {
                folderPathInput.value = data.path;
                scanFolder();
            }
        } catch (error) {
            console.error('打开对话框时出错:', error);
        }
    });

    scanBtn.addEventListener('click', scanFolder);
    folderPathInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') scanFolder();
    });

    saveBtn.addEventListener('click', async () => {
        if (!currentFile || !currentTable || Object.keys(pendingChanges).length === 0) return;

        // 保存当前滚动位置和聚焦的单元格
        const scrollLeft = dataContainer.scrollLeft;
        const scrollTop = dataContainer.scrollTop;
        const activeElement = document.activeElement;
        let activeCellPosition = null;

        // 如果当前有聚焦的单元格，记录其位置
        if (activeElement && activeElement.tagName === 'TD') {
            const row = activeElement.parentElement;
            const tbody = row.parentElement;
            const rows = Array.from(tbody.querySelectorAll('tr'));
            const rowIndex = rows.indexOf(row);
            const colIndex = Array.from(row.children).indexOf(activeElement);
            activeCellPosition = { rowIndex, colIndex };
        }

        statusDisplay.textContent = '保存中...';
        let successCount = 0;
        let errorCount = 0;

        for (const [rowId, updates] of Object.entries(pendingChanges)) {
            try {
                const response = await fetch('/api/update', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        path: currentFile.path,
                        tableName: currentTable,
                        id: rowId,
                        updates: updates
                    })
                });

                if (response.ok) {
                    successCount++;
                } else {
                    const errorText = await response.text();
                    console.error('保存行时出错:', rowId, errorText);
                    errorCount++;
                }
            } catch (error) {
                console.error('保存行时出错:', rowId, error);
                errorCount++;
            }
        }

        if (errorCount === 0) {
            statusDisplay.textContent = '所有更改已保存';
            pendingChanges = {};
            saveBtn.classList.remove('visible');

            // 清除当前标签页的缓存数据，强制重新加载
            if (currentTabIndex !== -1 && tabs[currentTabIndex]) {
                tabs[currentTabIndex].data = null;
                tabs[currentTabIndex].pendingChanges = {};
            }

            // 重新加载数据
            await loadFileData(currentFile, null, currentTable);

            // 恢复滚动位置和聚焦状态
            setTimeout(() => {
                dataContainer.scrollLeft = scrollLeft;
                dataContainer.scrollTop = scrollTop;

                // 恢复聚焦的单元格
                if (activeCellPosition) {
                    const tbody = dataContainer.querySelector('tbody');
                    if (tbody) {
                        const rows = tbody.querySelectorAll('tr');
                        if (rows[activeCellPosition.rowIndex]) {
                            const cell = rows[activeCellPosition.rowIndex].children[activeCellPosition.colIndex];
                            if (cell && cell.contentEditable) {
                                cell.focus();
                            }
                        }
                    }
                }
            }, 100); // 给渲染一点时间
        } else {
            statusDisplay.textContent = `已保存 ${successCount} 项，失败 ${errorCount} 项`;
        }
    });

    // Tab Management
    function switchTab(tab) {
        currentTab = tab;

        if (tab === 'geological') {
            tabGeological.classList.add('active');
            tabRawFiles.classList.remove('active');
            if (Object.keys(geologicalDataCache).length > 0) {
                renderGeologicalList(geologicalDataCache);
            } else {
                scanFolder();
            }
        } else {
            tabGeological.classList.remove('active');
            tabRawFiles.classList.add('active');
            if (rawFilesCache.length > 0) {
                renderRawFileList(rawFilesCache);
            } else {
                scanFolder();
            }
        }
    }

    tabGeological.addEventListener('click', () => switchTab('geological'));
    tabRawFiles.addEventListener('click', () => switchTab('raw'));

    // Horizontal Scroll with Wheel only at bottom
    dataContainer.addEventListener('wheel', (e) => {
        // 如果鼠标在列选择面板上，不处理滚轮事件


        const rect = dataContainer.getBoundingClientRect();
        // Check if mouse is within 20px of the bottom (scrollbar area)
        const isBottom = (e.clientY - rect.top) > (rect.height - 20);

        if (isBottom) {
            if (e.deltaY !== 0) {
                e.preventDefault();
                dataContainer.scrollLeft += e.deltaY;
            }
        }
    });

    async function scanFolder() {
        const path = folderPathInput.value.trim();
        if (!path) return;

        localStorage.setItem('dgss_last_path', path);
        statusDisplay.textContent = '扫描中...';
        fileList.innerHTML = '<div class="empty-state">扫描中...</div>';

        try {
            if (currentTab === 'geological') {
                const response = await fetch('/api/scan-geological', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ path })
                });

                const data = await response.json();

                if (response.ok) {
                    geologicalDataCache = data;
                    renderGeologicalList(data);
                    let totalItems = 0;
                    Object.values(data).forEach(category => {
                        if (category.items) totalItems += category.items.length;
                    });
                    statusDisplay.textContent = `找到 ${totalItems} 个地质数据项`;
                } else {
                    alert(data.error);
                    statusDisplay.textContent = '错误';
                }
            } else {
                const response = await fetch('/api/scan', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ path })
                });

                const data = await response.json();

                if (response.ok) {
                    rawFilesCache = data.files;
                    renderRawFileList(data.files);
                    statusDisplay.textContent = `找到 ${data.files.length} 个文件`;
                } else {
                    alert(data.error);
                    statusDisplay.textContent = '错误';
                }
            }
        } catch (error) {
            console.error('错误:', error);
            statusDisplay.textContent = '扫描文件夹时出错';
        }
    }

    function renderRawFileList(files) {
        fileList.innerHTML = '';

        if (!files || files.length === 0) {
            fileList.innerHTML = '<div class="empty-state">未找到支持的文件</div>';
            return;
        }

        const groups = {};
        files.forEach(file => {
            const ext = file.name.split('.').pop().toUpperCase();
            if (!groups[ext]) groups[ext] = [];
            groups[ext].push(file);
        });

        Object.keys(groups).sort().forEach(ext => {
            const categoryDiv = document.createElement('div');
            categoryDiv.className = 'category-group';

            const header = document.createElement('div');
            header.className = 'category-title';
            header.innerHTML = `<span>${ext} 文件</span> <span class="category-count">(${groups[ext].length})</span>`;
            categoryDiv.appendChild(header);

            const itemsContainer = document.createElement('div');
            itemsContainer.className = 'category-items';

            groups[ext].forEach(file => {
                const item = document.createElement('div');
                item.className = 'file-item';
                item.innerHTML = `
                    <div class="file-name" title="${file.name}">${file.name}</div>
                `;

                item.addEventListener('click', () => {
                    document.querySelectorAll('.file-item').forEach(i => i.classList.remove('active'));
                    item.classList.add('active');
                    loadFileData(file);
                });

                itemsContainer.appendChild(item);
            });

            categoryDiv.appendChild(itemsContainer);
            fileList.appendChild(categoryDiv);
        });
    }

    function renderGeologicalList(data) {
        fileList.innerHTML = '';
        let hasData = false;

        Object.entries(data).forEach(([category, config]) => {
            if (config.items && config.items.length > 0) {
                hasData = true;

                const group = document.createElement('div');
                group.className = 'category-group';

                const title = document.createElement('div');
                title.className = 'category-title';
                title.innerHTML = `
                    <span class="category-icon">${config.icon}</span>
                    <span class="category-name">${category}</span>
                    <span class="category-count">(${config.items.length})</span>
                `;
                title.onclick = () => {
                    group.classList.toggle('collapsed');
                };
                group.appendChild(title);

                const itemsContainer = document.createElement('div');
                itemsContainer.className = 'category-items';

                config.items.forEach(item => {
                    const itemEl = document.createElement('div');
                    itemEl.className = 'file-item';
                    itemEl.innerHTML = `
                        <div class="file-item-main">
                            <span class="file-name">${item.fileName}</span>
                            <span class="table-badge">${item.tableName}</span>
                        </div>
                        ${item.description ? `<div class="file-description">${item.description}</div>` : ''}
                    `;
                    itemEl.onclick = function () {
                        document.querySelectorAll('.file-item').forEach(el => el.classList.remove('active'));
                        itemEl.classList.add('active');
                        loadGeologicalData(item);
                    };
                    itemsContainer.appendChild(itemEl);
                });

                group.appendChild(itemsContainer);
                fileList.appendChild(group);
            }
        });

        if (!hasData) {
            fileList.innerHTML = '<div class="no-data">未找到地质数据</div>';
        }
    }

    async function loadGeologicalData(item) {
        // 检查是否已存在相同的标签页
        const file = {
            path: item.filePath,
            name: `${item.fileName} > ${item.tableName}`,
            type: 'geological'
        };

        const existingTabIndex = tabs.findIndex(tab =>
            tab.file.path === file.path && tab.tableName === item.tableName
        );

        let tab;
        let tabIndex;

        if (existingTabIndex !== -1) {
            // 如果已存在，切换到该标签页
            tabIndex = existingTabIndex;
            tab = tabs[tabIndex];
            currentTabIndex = tabIndex;
        } else {
            // 创建新标签页
            tab = {
                id: Date.now(),
                file: file,
                tableName: item.tableName,
                fileName: file.name,
                pendingChanges: {},
                data: null
            };
            tabs.push(tab);
            tabIndex = tabs.length - 1;
            currentTabIndex = tabIndex;
        }

        // 更新当前状态
        currentFile = tab.file;
        currentTable = tab.tableName;
        pendingChanges = tab.pendingChanges || {};

        // 重新渲染标签页
        renderTabs();

        // 更新界面
        fileNameDisplay.textContent = tab.fileName;

        // 如果标签页已有数据，直接渲染
        if (tab.data) {
            renderTable(tab.data);
            if (tab.data.allTables) {
                renderTableList(tab.data.allTables, tab.data.tableName, tab.file, null);
            }
            saveBtn.classList.toggle('visible', Object.keys(pendingChanges).length > 0);
            return;
        }

        statusDisplay.textContent = '正在加载数据...';
        dataContainer.innerHTML = '<div class="placeholder-content"><p>加载中...</p></div>';

        try {
            const response = await fetch('/api/data', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    path: item.filePath,
                    tableName: item.tableName
                })
            });

            const data = await response.json();

            if (response.ok) {
                // 保存数据到当前标签页
                tab.data = data;
                tab.tableName = data.tableName;

                currentTable = data.tableName;
                renderTable(data);
                if (data.allTables) {
                    renderTableList(data.allTables, data.tableName, tab.file, null);
                }
                statusDisplay.textContent = '就绪';
            } else {
                dataContainer.innerHTML = `<div class="placeholder-content" style="color: var(--error-color)"><p>${data.error}</p></div>`;
                statusDisplay.textContent = '加载文件时出错';
            }
        } catch (error) {
            console.error('错误:', error);
            dataContainer.innerHTML = '<div class="placeholder-content"><p>连接服务器时出错</p></div>';
        }
    }

    async function loadFileData(file, element, tableName = null) {
        if (element) {
            document.querySelectorAll('.file-item').forEach(el => el.classList.remove('active'));
            element.classList.add('active');
        }

        // 检查是否已存在相同的标签页
        const existingTabIndex = tabs.findIndex(tab =>
            tab.file.path === file.path && tab.tableName === tableName
        );

        let tab;
        let tabIndex;

        if (existingTabIndex !== -1) {
            // 如果已存在，切换到该标签页
            tabIndex = existingTabIndex;
            tab = tabs[tabIndex];
            currentTabIndex = tabIndex;
        } else {
            // 创建新标签页
            tab = {
                id: Date.now(),
                file: file,
                tableName: tableName,
                fileName: file.name,
                pendingChanges: {},
                data: null
            };
            tabs.push(tab);
            tabIndex = tabs.length - 1;
            currentTabIndex = tabIndex;
        }

        // 更新当前状态
        currentFile = tab.file;
        currentTable = tab.tableName;
        pendingChanges = tab.pendingChanges || {};

        // 重新渲染标签页
        renderTabs();

        // 更新界面
        fileNameDisplay.textContent = tab.fileName;

        // 如果标签页已有数据，直接渲染
        if (tab.data) {
            renderTable(tab.data);
            if (tab.data.allTables) {
                renderTableList(tab.data.allTables, tab.data.tableName, tab.file, element);
            }
            saveBtn.classList.toggle('visible', Object.keys(pendingChanges).length > 0);
            return;
        }

        statusDisplay.textContent = '正在加载数据...';
        dataContainer.innerHTML = '<div class="placeholder-content"><p>加载中...</p></div>';

        try {
            const response = await fetch('/api/data', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    path: file.path,
                    tableName: tableName
                })
            });

            const data = await response.json();

            if (response.ok) {
                // 保存数据到当前标签页
                tab.data = data;
                tab.tableName = data.tableName;

                currentTable = data.tableName;
                renderTable(data);
                renderTableList(data.allTables, data.tableName, tab.file, element);
                statusDisplay.textContent = '就绪';
            } else {
                dataContainer.innerHTML = `<div class="placeholder-content" style="color: var(--error-color)"><p>${data.error}</p></div>`;
                statusDisplay.textContent = '加载文件时出错';
            }
        } catch (error) {
            console.error('错误:', error);
            dataContainer.innerHTML = '<div class="placeholder-content"><p>连接服务器时出错</p></div>';
        }
    }

    function renderTableList(tables, currentTable, file, element) {
        tableListDisplay.innerHTML = '';
        if (!tables) return;

        tables.forEach(table => {
            const chip = document.createElement('div');
            chip.className = `table-chip ${table === currentTable ? 'active' : ''}`;
            chip.textContent = table;
            chip.onclick = () => loadFileData(file, element, table);
            tableListDisplay.appendChild(chip);
        });
    }

    function renderTable(data) {
        if (!data.rows || data.rows.length === 0) {
            dataContainer.innerHTML = '<div class="placeholder-content"><p>此表中没有数据</p></div>';
            return;
        }

        const table = document.createElement('table');
        const thead = document.createElement('thead');
        const tbody = document.createElement('tbody');

        // Make table focusable for keyboard events
        table.tabIndex = 0;
        table.style.outline = 'none';

        // 添加单元格选择范围元素
        const selectionRange = document.createElement('div');
        selectionRange.className = 'selection-range';
        selectionRange.style.display = 'none';
        dataContainer.appendChild(selectionRange);

        // 单元格选择状态
        let isSelecting = false;
        let startCell = null;
        let endCell = null;

        // 行高调整状态
        let isResizingRow = false;
        let startY = 0;
        let startHeight = 0;
        let currentRow = null;

        // 排序状态
        let sortColumn = null;
        let sortDirection = 'asc'; // 'asc' or 'desc'

        function renderRows() {
            tbody.innerHTML = '';
            const fragment = document.createDocumentFragment();

            data.rows.forEach((row, index) => {
                // Ensure each row has a unique UI ID for DOM tracking
                if (!row._ui_id) {
                    row._ui_id = 'row_' + Date.now() + '_' + index + '_' + Math.random().toString(36).substr(2, 9);
                }

                const tr = document.createElement('tr');
                tr.style.position = 'relative';
                tr.dataset.uiId = row._ui_id;

                // 优先使用后端返回的确切主键
                let rowId;
                if (data.primaryKey && row[data.primaryKey] !== undefined) {
                    rowId = row[data.primaryKey];
                } else {
                    // Fallback
                    rowId = row['GeoID'] || row['ID'] || row['_id'] || row[data.columns[0]];
                }
                tr.dataset.rowId = rowId; // Store for retrieval during edit

                // 添加行高调整手柄
                const rowResizer = document.createElement('div');
                rowResizer.className = 'row-resizer';

                rowResizer.addEventListener('mousedown', (e) => {
                    isResizingRow = true;
                    startY = e.pageY;
                    startHeight = tr.offsetHeight;
                    currentRow = tr;
                    table.classList.add('resizing-row');
                    e.preventDefault();
                    e.stopPropagation();
                });

                data.columns.forEach((col, index) => {
                    const td = document.createElement('td');

                    if (index === 0) {
                        td.appendChild(rowResizer);
                    }

                    td.textContent = row[col];
                    td.setAttribute('data-column', col);
                    td.setAttribute('tabindex', '-1'); // Make cell focusable programmatically

                    if (col !== 'GeoID') {
                        // Click to edit (Select All)
                        td.addEventListener('click', () => {
                            if (!td.isContentEditable) {
                                enterEditMode(td, rowId, true); // true = selectAll
                            }
                        });

                        // Double click (Move cursor to end for appending)
                        td.addEventListener('dblclick', () => {
                            if (td.isContentEditable) {
                                // Clear selection and move cursor to end
                                const range = document.createRange();
                                range.selectNodeContents(td);
                                range.collapse(false); // false = to end
                                const sel = window.getSelection();
                                sel.removeAllRanges();
                                sel.addRange(range);
                            } else {
                                // Fallback if single click didn't trigger for some reason
                                enterEditMode(td, rowId, false);
                            }
                        });

                        td.addEventListener('mousedown', (e) => {
                            // Only handle left click
                            if (e.button !== 0) return;

                            // Allow default behavior (text selection) if editing this cell
                            if (td.isContentEditable) {
                                return;
                            }

                            // Prevent native text selection ONLY if NOT editing
                            e.preventDefault();

                            if (e.ctrlKey || e.metaKey) {
                                td.classList.toggle('selected');
                            } else if (e.shiftKey && startCell) {
                                endCell = td;
                                updateSelectionRange();
                            } else {
                                clearSelection();
                                selectCell(td);
                                startCell = td;
                                endCell = td;
                                selectionRange.style.display = 'none';
                            }
                        });
                    }

                    tr.appendChild(td);
                });
                fragment.appendChild(tr);
            });
            tbody.appendChild(fragment);
        }

        function reorderRows() {
            // Create a map of existing rows for O(1) lookup
            const rowMap = new Map();
            Array.from(tbody.children).forEach(tr => {
                if (tr.dataset.uiId) {
                    rowMap.set(tr.dataset.uiId, tr);
                }
            });

            const fragment = document.createDocumentFragment();
            data.rows.forEach(row => {
                const tr = rowMap.get(row._ui_id);
                if (tr) {
                    fragment.appendChild(tr); // Moves the element
                } else {
                    // Fallback if row not found (shouldn't happen if logic is correct)
                    console.warn('Row element not found for reordering, rebuilding...');
                    renderRows();
                    return;
                }
            });
            tbody.appendChild(fragment);
        }

        const headerRow = document.createElement('tr');
        data.columns.forEach((col, index) => {
            const th = document.createElement('th');

            // Apply column mapping if available
            let displayText = col;
            if (data.columnMapping && data.columnMapping[col]) {
                displayText = data.columnMapping[col];
                // Add original name as subtitle or tooltip
                th.title = `${col}`;
                th.innerHTML = `${displayText}<span class="header-subtitle">${col}</span>`;
                th.classList.add('mapped-header');
            } else {
                th.textContent = col;
            }

            th.setAttribute('data-column-index', index);

            // Sorting
            th.addEventListener('click', (e) => {
                // Ignore if clicking resizer
                if (e.target.classList.contains('column-resizer')) return;

                if (sortColumn === col) {
                    sortDirection = sortDirection === 'asc' ? 'desc' : 'asc';
                } else {
                    sortColumn = col;
                    sortDirection = 'asc';
                }

                // Update UI
                thead.querySelectorAll('th').forEach(h => {
                    h.classList.remove('sort-asc', 'sort-desc');
                });
                th.classList.add(sortDirection === 'asc' ? 'sort-asc' : 'sort-desc');
                // Sort Data
                data.rows.sort((a, b) => {
                    let valA = a[col];
                    let valB = b[col];

                    // Try numeric sort
                    const numA = parseFloat(valA);
                    const numB = parseFloat(valB);
                    if (!isNaN(numA) && !isNaN(numB)) {
                        valA = numA;
                    } else {
                        valA = String(valA || '').toLowerCase();
                        valB = String(valB || '').toLowerCase();
                    }

                    if (valA < valB) return sortDirection === 'asc' ? -1 : 1;
                    if (valA > valB) return sortDirection === 'asc' ? 1 : -1;
                    return 0;
                });

                reorderRows();
            });

            // Column Resizer
            const resizer = document.createElement('div');
            resizer.className = 'column-resizer';

            let isResizing = false;
            let startX = 0;
            let startWidth = 0;

            resizer.addEventListener('mousedown', (e) => {
                isResizing = true;
                startX = e.pageX;
                startWidth = th.offsetWidth;
                table.classList.add('resizing');
                resizer.classList.add('resizing');
                e.preventDefault();
                e.stopPropagation();
            });

            document.addEventListener('mousemove', (e) => {
                if (!isResizing) return;
                const diff = e.pageX - startX;
                const newWidth = Math.max(60, startWidth + diff);
                th.style.width = newWidth + 'px';
                th.style.minWidth = newWidth + 'px';
                th.style.maxWidth = newWidth + 'px';

                // Update all cells in this column
                tbody.querySelectorAll(`tr td:nth-child(${index + 1})`).forEach(td => {
                    td.style.width = newWidth + 'px';
                    td.style.minWidth = newWidth + 'px';
                    td.style.maxWidth = newWidth + 'px';
                });
            });

            document.addEventListener('mouseup', () => {
                if (isResizing) {
                    isResizing = false;
                    table.classList.remove('resizing');
                    resizer.classList.remove('resizing');
                }
            });

            resizer.addEventListener('dblclick', (e) => {
                e.stopPropagation(); // Prevent sort
                // Auto resize logic (simplified)
                th.style.width = 'auto';
                th.style.minWidth = '100px';
            });

            th.appendChild(resizer);
            headerRow.appendChild(th);
        });
        thead.appendChild(headerRow);

        renderRows();

        // Row Resizing Global Listeners
        document.addEventListener('mousemove', (e) => {
            if (!isResizingRow || !currentRow) return;
            const diff = e.pageY - startY;
            const newHeight = Math.max(30, startHeight + diff);
            currentRow.style.height = newHeight + 'px';
        });

        document.addEventListener('mouseup', () => {
            if (isResizingRow) {
                isResizingRow = false;
                table.classList.remove('resizing-row');
                currentRow = null;
            }
        });

        // Table Selection Logic
        table.addEventListener('mousedown', (e) => {
            if (e.target.tagName === 'TD') {
                isSelecting = true;
                // Handled in TD mousedown
            }
        });

        document.addEventListener('mousemove', (e) => {
            if (!isSelecting) return;
            if (e.target.tagName === 'TD' && table.contains(e.target)) {
                endCell = e.target;
                updateSelectionRange();
            }
        });

        document.addEventListener('mouseup', () => {
            isSelecting = false;
        });

        function clearSelection() {
            document.querySelectorAll('td.selected').forEach(cell => {
                cell.classList.remove('selected');
            });
        }

        function selectCell(cell) {
            cell.classList.add('selected');
            cell.focus();
        }

        function enterEditMode(cell, directRowId, selectAll = true) {
            if (cell.getAttribute('data-column') === 'GeoID') return;
            cell.contentEditable = true;
            cell.focus();

            if (selectAll) {
                // Select all text
                const range = document.createRange();
                range.selectNodeContents(cell);
                const sel = window.getSelection();
                sel.removeAllRanges();
                sel.addRange(range);
            }
            // If selectAll is false, we let browser/dblclick handle cursor placement

            const originalText = cell.textContent;

            const blurHandler = () => {
                cell.contentEditable = false;
                cell.removeEventListener('blur', blurHandler);
                cell.removeEventListener('keydown', keyHandler);

                if (cell.textContent !== originalText) {
                    const row = cell.parentElement;
                    const rId = directRowId || row.dataset.rowId; // Correct ID retrieval
                    const col = cell.getAttribute('data-column');

                    if (!pendingChanges[rId]) pendingChanges[rId] = {};
                    pendingChanges[rId][col] = cell.textContent;
                    cell.classList.add('modified');
                    saveBtn.classList.add('visible');
                    statusDisplay.textContent = '有未保存的更改...';
                }
            };

            const keyHandler = (e) => {
                if (e.key === 'Enter') {
                    e.preventDefault();
                    cell.blur();
                } else if (e.key === 'Escape') {
                    cell.textContent = originalText;
                    cell.blur();
                }
            };

            cell.addEventListener('blur', blurHandler);
            cell.addEventListener('keydown', keyHandler);
        }

        function updateSelectionRange() {
            if (!startCell || !endCell) return;

            clearSelection();

            const startRow = startCell.parentElement;
            const endRow = endCell.parentElement;
            const rows = Array.from(tbody.children);
            const startRowIdx = rows.indexOf(startRow);
            const endRowIdx = rows.indexOf(endRow);

            const startColIdx = Array.from(startRow.children).indexOf(startCell);
            const endColIdx = Array.from(endRow.children).indexOf(endCell);

            const minRow = Math.min(startRowIdx, endRowIdx);
            const maxRow = Math.max(startRowIdx, endRowIdx);
            const minCol = Math.min(startColIdx, endColIdx);
            const maxCol = Math.max(startColIdx, endColIdx);

            for (let i = minRow; i <= maxRow; i++) {
                const row = rows[i];
                for (let j = minCol; j <= maxCol; j++) {
                    row.children[j].classList.add('selected');
                }
            }

            // Update visual selection box (optional, simplified to just highlighting cells for now)
        }

        // Keyboard Navigation & Shortcuts
        table.addEventListener('keydown', (e) => {
            const selectedCells = document.querySelectorAll('td.selected');
            if (selectedCells.length === 0) return;

            const lastSelected = selectedCells[selectedCells.length - 1];
            const row = lastSelected.parentElement;
            const rows = Array.from(tbody.children);
            const rowIndex = rows.indexOf(row);
            const colIndex = Array.from(row.children).indexOf(lastSelected);

            // Edit Mode
            if (e.key === 'F2') {
                enterEditMode(lastSelected);
                return;
            }

            // Delete
            if (e.key === 'Delete' || e.key === 'Backspace') {
                if (!lastSelected.isContentEditable) {
                    selectedCells.forEach(cell => {
                        if (cell.getAttribute('data-column') !== 'GeoID') {
                            // Trigger edit logic to save change
                            const originalText = cell.textContent;
                            cell.textContent = '';
                            // Manually trigger update logic
                            enterEditMode(cell);
                            cell.blur(); // Commit immediately
                        }
                    });
                }
                return;
            }

            // Copy
            if (e.ctrlKey && (e.key === 'c' || e.key === 'C')) {
                e.preventDefault();

                // Group cells by row index
                const rows = {};
                selectedCells.forEach(cell => {
                    const tr = cell.parentElement;
                    const rowIndex = Array.from(tbody.children).indexOf(tr);
                    if (!rows[rowIndex]) rows[rowIndex] = [];
                    // Insert at correct column position to maintain order if selection is disjoint
                    // But usually selection is contiguous range or single content
                    // For now, simpler map is fine as querySelectorAll follows DOM order (row by row, col by col)
                    rows[rowIndex].push(cell.textContent);
                });

                // Join row content with tabs, and rows with newlines
                const text = Object.values(rows)
                    .map(rowCells => rowCells.join('\t'))
                    .join('\n');

                navigator.clipboard.writeText(text).then(() => {
                    showToast('已复制');
                });
                return;
            }

            // Paste
            if (e.ctrlKey && (e.key === 'v' || e.key === 'V')) {
                e.preventDefault();
                navigator.clipboard.readText().then(text => {
                    if (!text) return;
                    // Simple paste to single cell or first cell of selection
                    const targetCell = selectedCells[0];
                    if (targetCell.getAttribute('data-column') !== 'GeoID') {
                        enterEditMode(targetCell);
                        targetCell.textContent = text; // This might need more complex logic for multi-cell paste
                        targetCell.blur();
                        showToast('已粘贴');
                    }
                });
                return;
            }

            // Navigation
            let nextRow = rowIndex;
            let nextCol = colIndex;

            if (e.key === 'ArrowUp') nextRow--;
            else if (e.key === 'ArrowDown') nextRow++;
            else if (e.key === 'ArrowLeft') nextCol--;
            else if (e.key === 'ArrowRight') nextCol++;
            else if (e.key === 'Tab') {
                e.preventDefault();
                if (e.shiftKey) nextCol--; else nextCol++;
            }
            else if (e.key === 'Enter') {
                e.preventDefault();
                if (e.shiftKey) nextRow--; else nextRow++;
            }
            else {
                return; // Not a navigation key
            }

            // Boundary checks
            if (nextRow >= 0 && nextRow < rows.length && nextCol >= 0 && nextCol < data.columns.length) {
                e.preventDefault();
                const nextCell = rows[nextRow].children[nextCol];
                clearSelection();
                selectCell(nextCell);
                startCell = nextCell;
                endCell = nextCell;

                // Scroll into view
                nextCell.scrollIntoView({ block: 'nearest', inline: 'nearest' });
            }
        });

        table.appendChild(thead);
        table.appendChild(tbody);



        dataContainer.innerHTML = '';

        dataContainer.appendChild(table);
        dataContainer.appendChild(selectionRange);
    }

    function showToast(message) {
        let toast = document.querySelector('.toast');
        if (!toast) {
            toast = document.createElement('div');
            toast.className = 'toast';
            document.body.appendChild(toast);
        }
        toast.textContent = message;
        toast.classList.add('show');
        setTimeout(() => toast.classList.remove('show'), 2000);
    }

    // 标签页相关函数
    function renderTabs() {
        tabsList.innerHTML = '';

        tabs.forEach((tab, index) => {
            const tabElement = document.createElement('div');
            tabElement.className = `tab ${index === currentTabIndex ? 'active' : ''}`;
            tabElement.setAttribute('data-tab-index', index);

            const tabContent = document.createElement('span');
            tabContent.className = 'tab-content';
            tabContent.textContent = tab.fileName;

            const tabClose = document.createElement('button');
            tabClose.className = 'tab-close';
            tabClose.textContent = '×';
            tabClose.title = '关闭标签页';

            tabElement.appendChild(tabContent);
            tabElement.appendChild(tabClose);
            tabsList.appendChild(tabElement);

            // 添加标签页点击事件
            tabElement.addEventListener('click', (e) => {
                if (!e.target.classList.contains('tab-close')) {
                    switchToTab(index);
                }
            });

            // 添加标签页关闭事件
            tabClose.addEventListener('click', (e) => {
                e.stopPropagation();
                closeTab(index);
            });
        });
    }

    function switchToTab(index) {
        if (index < 0 || index >= tabs.length) return;

        // 保存当前标签页的状态
        if (currentTabIndex !== -1) {
            tabs[currentTabIndex].pendingChanges = pendingChanges;
            tabs[currentTabIndex].currentTable = currentTable;
        }

        // 切换到新标签页
        currentTabIndex = index;
        const tab = tabs[index];

        // 更新当前状态
        currentFile = tab.file;
        currentTable = tab.tableName;
        pendingChanges = tab.pendingChanges || {};

        // 重新渲染标签页
        renderTabs();

        // 更新界面
        fileNameDisplay.textContent = tab.fileName;

        // 如果标签页已有数据，直接渲染
        if (tab.data) {
            renderTable(tab.data);
            if (tab.data.allTables) {
                renderTableList(tab.data.allTables, tab.data.tableName, tab.file, null);
            }
            saveBtn.classList.toggle('visible', Object.keys(pendingChanges).length > 0);
        }
    }

    function closeTab(index) {
        if (index < 0 || index >= tabs.length) return;

        // 移除标签页
        tabs.splice(index, 1);

        // 如果关闭的是当前标签页，切换到前一个标签页或清空
        if (index === currentTabIndex) {
            if (tabs.length > 0) {
                currentTabIndex = Math.min(index, tabs.length - 1);
                switchToTab(currentTabIndex);
            } else {
                // 清空界面
                currentTabIndex = -1;
                currentFile = null;
                currentTable = null;
                pendingChanges = {};
                fileNameDisplay.textContent = '选择一个文件';
                dataContainer.innerHTML = `
                    <div class="placeholder-content">
                        <div class="developer-card">
                            <div class="dev-header">
                                <div class="icon">📂</div>
                                <h2>DGSS数据管理平台</h2>
                            </div>
                            
                            <div class="dev-content-body">
                                <div class="dev-info-side">
                                    <div class="info-item">
                                        <span class="label">开发单位</span>
                                        <span class="value">浙江省宁波地质院 基础地质调查研究中心</span>
                                    </div>
                                    <div class="info-item">
                                        <span class="label">开发者</span>
                                        <span class="value">丁正鹏</span>
                                    </div>
                                    <div class="info-item">
                                        <span class="label">联系方式</span>
                                        <span class="value">zhengpengding@outlook.com</span>
                                    </div>
                                </div>

                                <div class="divider-vertical"></div>

                                <div class="dev-donation-side">
                                    <img src="/static/recived_money.png" alt="Support" class="donation-image">
                                    <p class="donation-hint">如果觉得好用话，请作者喝杯咖啡☕吧！</p>
                                </div>
                            </div>
                        </div>
                    </div>`;
                saveBtn.classList.remove('visible');
                renderTabs();
            }
        } else if (index < currentTabIndex) {
            // 如果关闭的是当前标签页之前的标签页，调整当前标签页索引
            currentTabIndex--;
            renderTabs();
        } else {
            renderTabs();
        }
    }
});
