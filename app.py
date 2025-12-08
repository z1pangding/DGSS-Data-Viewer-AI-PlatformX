from flask import Flask, render_template, request, jsonify, Response
import os
import json
import sqlite3
import fnmatch
import threading
import tkinter as tk
from tkinter import filedialog
from geological_mapping import GEOLOGICAL_CATEGORIES
from analyze_structure import analyze_database_structure

import ollama_service

app = Flask(__name__)

# Global flag for Ollama availability
OLLAMA_AVAILABLE = False
# Global Cache for Database Schema
GLOBAL_SCHEMA_CACHE = "No database loaded."

def get_db_connection(db_path):
    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row
    return conn

def categorize_file(filename):
    ext = os.path.splitext(filename)[1].lower()
    if ext == '.ta':
        return 'Points'
    elif ext == '.la':
        return 'Lines'
    elif ext == '.pa':
        return 'Polygons'
    elif ext == '.db':
        return 'Notes'
    return 'Other'

@app.route('/')
def index():
    return render_template('index.html')

# Global Cache for Database Files (for Search)
GLOBAL_DB_FILES = []

@app.route('/api/scan', methods=['POST'])
def scan_folder():
    folder_path = request.json.get('path')
    if not folder_path:
        return jsonify({'error': 'Path is required'}), 400
        
    # Remove quotes if user pasted them
    folder_path = folder_path.strip('"\'')
    
    if not os.path.exists(folder_path):
        return jsonify({'error': 'Path does not exist'}), 400
    
    files = []
    # Reset schema cache on new scan
    global GLOBAL_SCHEMA_CACHE
    GLOBAL_SCHEMA_CACHE = ""
    global GLOBAL_DB_FILES
    GLOBAL_DB_FILES = []
    
    try:
        for root, dirs, files_in_dir in os.walk(folder_path):
            for f in files_in_dir:
                if f.endswith(('.ta', '.la', '.pa', '.db')):
                    # Create a relative path for display if it's in a subdir
                    rel_path = os.path.relpath(os.path.join(root, f), folder_path)
                    display_name = rel_path if root != folder_path else f
                    full_path = os.path.join(root, f)
                    
                    category = categorize_file(f)
                    
                    # [AI] Global Scan for Database Structure
                    # Scan all supported files (.ta, .la, .pa, .db) as they are all SQLite
                    print(f"[AI] Scanning schema for: {f}")
                    schema_part = analyze_database_structure(full_path)
                    if schema_part:
                       GLOBAL_SCHEMA_CACHE += schema_part + "\n\n"
                       GLOBAL_DB_FILES.append(full_path)
                    
                    files.append({
                        'name': display_name,
                        'category': category,
                        'path': full_path
                    })
    except Exception as e:
        return jsonify({'error': str(e)}), 500
    
    return jsonify({'files': files})



def file_has_table(file_path, table_name):
    """检查文件中是否包含指定表"""
    try:
        conn = get_db_connection(file_path)
        cursor = conn.cursor()
        cursor.execute("SELECT name FROM sqlite_master WHERE type='table' AND name=?", 
                      (table_name,))
        result = cursor.fetchone() is not None
        conn.close()
        return result
    except:
        return False

def table_has_fields(file_path, table_name, required_fields):
    """检查表中是否包含所需字段"""
    try:
        conn = get_db_connection(file_path)
        cursor = conn.cursor()
        cursor.execute(f"PRAGMA table_info({table_name})")
        columns = [row[1] for row in cursor.fetchall()]
        conn.close()
        return all(field in columns for field in required_fields)
    except:
        return False

def get_table_primary_key(conn, table_name):
    """获取表的主键列名"""
    try:
        cursor = conn.cursor()
        cursor.execute(f"PRAGMA table_info({table_name})")
        columns_info = cursor.fetchall()
        
        # 1. Check for defined primary key
        for col_info in columns_info:
            if col_info[5] == 1:
                return col_info[1]
                
        # 2. Check for common ID names
        for col_info in columns_info:
            col_name = col_info[1]
            # 扩展支持常见地质字段作为主键
            # DGSS specific: ROUTECODE, GEOPOINT, GUID, etc.
            if col_name.upper() in ('ROUTECODE', 'GEOPOINT', 'GUID', 'GEOLABEL', 'ID', '_ID', 'GEOID', 'CODE'):
                return col_name
                
        return None
    except:
        return None



@app.route('/api/scan-geological', methods=['POST'])
def scan_geological():
    """按地质分类扫描数据"""
    folder_path = request.json.get('path')
    if not folder_path:
        return jsonify({'error': 'Path is required'}), 400
    
    folder_path = folder_path.strip('"\'')
    if not os.path.exists(folder_path):
        return jsonify({'error': 'Path does not exist'}), 400
    
    result = {}
    
    try:
        # 遍历所有支持的文件
        all_files = []
        for root, dirs, files in os.walk(folder_path):
            for f in files:
                if f.endswith(('.ta', '.la', '.pa', '.db')):
                    file_path = os.path.join(root, f)
                    rel_path = os.path.relpath(file_path, folder_path)
                    all_files.append({
                        'name': f,
                        'relative_path': rel_path,
                        'full_path': file_path,
                        'parent_folder': os.path.basename(root)
                    })
        
        # 按地质分类匹配文件
        for category, config in GEOLOGICAL_CATEGORIES.items():
            result[category] = {
                'icon': config['icon'],
                'en_name': config['en_name'],
                'items': []
            }
            
            for rule in config['rules']:
                pattern = rule['file_pattern']
                table_name = rule['table']
                
                for file_info in all_files:
                    # 检查文件是否匹配pattern
                    if fnmatch.fnmatch(file_info['relative_path'], pattern) or \
                       fnmatch.fnmatch(file_info['name'], pattern):
                        
                        # 检查该文件中是否有指定的表
                        if file_has_table(file_info['full_path'], table_name):
                            # 可选：检查字段
                            if 'check_fields' in rule:
                                if not table_has_fields(file_info['full_path'], 
                                                       table_name, 
                                                       rule['check_fields']):
                                    continue
                            
                            # 避免重复添加
                            item_key = f"{file_info['full_path']}:{table_name}"
                            existing_keys = [f"{item['filePath']}:{item['tableName']}" 
                                           for item in result[category]['items']]
                            
                            if item_key not in existing_keys:
                                result[category]['items'].append({
                                    'fileName': file_info['relative_path'],
                                    'tableName': table_name,
                                    'filePath': file_info['full_path'],
                                    'description': rule.get('description', ''),
                                    'rowFilter': rule.get('row_filter')
                                })
        
        return jsonify(result)
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@app.route('/api/data', methods=['POST'])
def get_data():
    file_path = request.json.get('path')
    requested_table = request.json.get('tableName')
    
    if not file_path or not os.path.exists(file_path):
        return jsonify({'error': 'File not found'}), 404
    
    try:
        conn = get_db_connection(file_path)
        cursor = conn.cursor()
        
        # Get all tables
        cursor.execute("SELECT name FROM sqlite_master WHERE type='table';")
        tables = [row['name'] for row in cursor.fetchall()]
        
        data = {}
        target_table = None

        if tables:
            if requested_table and requested_table in tables:
                target_table = requested_table
            else:
                # Prioritize non-system tables if no specific table requested
                target_table = tables[0]
                for t in tables:
                    if t not in ['android_metadata', 'sqlite_sequence']:
                        target_table = t
                        break
            
            # 直接查询表中的所有列，不添加额外的_id列
            cursor.execute(f"SELECT * FROM {target_table}")
            rows = cursor.fetchall()
            
            if rows:
                columns = [description[0] for description in cursor.description]
                data['columns'] = columns
                # 手动创建字典，确保列名与值正确对应，避免sqlite3.Row转换问题
                data['rows'] = []
                for row in rows:
                    row_dict = {}
                    for i, col_name in enumerate(columns):
                        row_dict[col_name] = row[i]
                    data['rows'].append(row_dict)
            else:
                # Handle empty table case
                cursor.execute(f"PRAGMA table_info({target_table})")
                # 获取实际表结构，不添加额外的_id列
                columns = [info[1] for info in cursor.fetchall()]
                data['columns'] = columns
                data['rows'] = []
                
            data['tableName'] = target_table
            data['allTables'] = tables
            
            # 查找字段映射
            column_mapping = {}
            try:
                # 获取文件名（不含路径）
                filename = os.path.basename(file_path)
                
                # 遍历所有配置规则寻找匹配
                for category, config in GEOLOGICAL_CATEGORIES.items():
                    for rule in config['rules']:
                        pattern = rule['file_pattern']
                        rule_table = rule.get('table')
                        
                        # 检查文件名匹配 (处理带通配符的情况)
                        # 注意：这里简单的fnmatch可能不够，因为某些pattern可能是 "素描图/*.la"
                        # 我们先只匹配文件名部分，如果有目录前缀的pattern暂时忽略目录匹配或者简单处理
                        
                        is_match = False
                        
                        # 如果pattern包含路径分隔符，尝试匹配相对路径（这里简单化处理，只匹配文件名部分）
                        # 实际上geological_mapping.py里的pattern大多是文件名，除了 "素描图/*.la"
                        simple_pattern = os.path.basename(pattern)
                        
                        if fnmatch.fnmatch(filename, simple_pattern):
                            # 检查表名是否匹配 (如果规则指定了特定表)
                            if rule_table and rule_table == target_table:
                                is_match = True
                            # 如果规则没指定表，或者我们只是想找通用的映射(通常规则都会指定表)
                            
                        if is_match:
                            if 'fields' in rule:
                                column_mapping = rule['fields']
                            break
                    if column_mapping:
                        break
            except Exception as e:
                print(f"Error finding mapping: {e}")
                
            data['columnMapping'] = column_mapping
            
            # Detect Primary Key
            # Detect Primary Key
            raw_primary_key = get_table_primary_key(conn, target_table)
            
            # Ensure the Primary Key matches the casing in cursor.description (data['columns'])
            # PRAGMA table_info might return different casing than cursor.description
            final_primary_key = None
            if raw_primary_key and data['rows']:
                # First check exact match in actual row data
                if raw_primary_key in data['rows'][0]:
                     final_primary_key = raw_primary_key
                else:
                     # Check case-insensitive match
                     for col in data['rows'][0].keys():
                         if col.lower() == raw_primary_key.lower():
                             final_primary_key = col
                             break
            
            # If not found in rows (empty table) or matched, use raw
            if not final_primary_key:
                final_primary_key = raw_primary_key

            data['primaryKey'] = final_primary_key
            
            # 如果存在有效的字段映射，过滤并重排序显示的列
            # 仅显示映射中定义的列，并保持映射定义的顺序
            # 数据对象(row)中仍然包含所有字段，所以不会影响通过隐藏字段(如GeoID)进行的操作
            if column_mapping:
                # 获取实际存在于表中的映射列
                filtered_columns = [col for col in column_mapping.keys() if col in data['columns']]
                
                # 只有当过滤后仍有列时才应用（防止配置错误导致空表）
                if filtered_columns:
                    data['columns'] = filtered_columns
            
            # Debug logging
            print(f"DEBUG Table: {target_table}, Found PK: {raw_primary_key}, Final PK: {final_primary_key}")
            if data['rows']:
                print(f"DEBUG First Row Keys: {list(data['rows'][0].keys())}")
            
        conn.close()
        return jsonify(data)
    except Exception as e:

        return jsonify({'error': str(e)}), 500

@app.route('/api/update', methods=['POST'])
def update_data():
    data = request.json
    file_path = data.get('path')
    table_name = data.get('tableName')
    row_id = data.get('id')
    updates = data.get('updates') # Dict of col: value
    
    if not all([file_path, table_name, updates]) or row_id is None:
        return jsonify({'error': 'Missing required fields'}), 400
        
    try:
        conn = get_db_connection(file_path)
        cursor = conn.cursor()
        
        # 自动检测表的主键列
        primary_key_col = get_table_primary_key(conn, table_name)
        
        # 如果仍然没有找到合适的主键列，返回错误
        if not primary_key_col:
            print(f"Update failed: No primary key found for table {table_name}")
            conn.close()
            return jsonify({'error': '无法确定表的主键列'}), 400
        
        # Construct SQL update
        set_clause = ", ".join([f"{col} = ?" for col in updates.keys()])
        values = list(updates.values())
        values.append(row_id)
        
        print(f"Updating {table_name}: PK={primary_key_col}, ID={row_id}, Updates={updates}")
        
        # 使用正确的主键列作为更新条件
        query = f"UPDATE {table_name} SET {set_clause} WHERE {primary_key_col} = ?"
        
        cursor.execute(query, values)
        
        # 如果更新行数为0，尝试转换ID类型重试
        if cursor.rowcount == 0:
            print(f"Initial update affected 0 rows. Retrying with type conversion for ID: {row_id} (type: {type(row_id)})")
            
            # 尝试转换类型
            new_row_id = None
            if isinstance(row_id, str):
                if row_id.isdigit():
                    new_row_id = int(row_id)
            elif isinstance(row_id, int):
                new_row_id = str(row_id)
            
            if new_row_id is not None:
                print(f"Retrying with new ID: {new_row_id} (type: {type(new_row_id)})")
                values[-1] = new_row_id
                cursor.execute(query, values)
                if cursor.rowcount > 0:
                    print("Retry successful!")
                else:
                    print("Retry failed.")
            else:
                print("No type conversion possible.")
                
        conn.commit()
        conn.close()
        
        return jsonify({'success': True, 'primaryKeyUsed': primary_key_col})
    except Exception as e:
        return jsonify({'error': str(e)}), 500



def open_folder_dialog():
    """打开文件夹选择对话框，支持高DPI屏幕"""
    try:
        # 在Windows上启用高DPI感知
        import platform
        if platform.system() == 'Windows':
            try:
                from ctypes import windll
                # 设置DPI感知级别为Per-Monitor V2 (最佳)
                # 如果失败，回退到System DPI Aware
                try:
                    windll.shcore.SetProcessDpiAwareness(2)  # PROCESS_PER_MONITOR_DPI_AWARE
                except:
                    try:
                        windll.user32.SetProcessDPIAware()  # Fallback to system DPI aware
                    except:
                        pass  # 如果都失败了，使用默认设置
            except:
                pass  # 如果导入失败，继续使用默认设置
    except:
        pass
    
    root = tk.Tk()
    root.withdraw()  # Hide the main window
    root.attributes('-topmost', True)  # Make it appear on top
    
    # 设置窗口缩放因子以适应高DPI
    try:
        root.tk.call('tk', 'scaling', 2.0)  # 增加缩放因子
    except:
        pass
    
    folder_path = filedialog.askdirectory(title="选择DGSS数据文件夹")
    try:
        root.iconbitmap('icon.ico')
    except:
        pass
    root.destroy()
    return folder_path

@app.route('/api/select-folder', methods=['POST'])
def select_folder():
    # Run in a separate thread to avoid blocking Flask
    result = [None]
    def target():
        result[0] = open_folder_dialog()
    
    t = threading.Thread(target=target)
    t.start()
    t.join()
    
    path = result[0]
    if path:
        return jsonify({'path': path})
    return jsonify({'path': None})

def open_file_dialog():
    """打开文件选择对话框，支持高DPI屏幕"""
    try:
        # 在Windows上启用高DPI感知
        import platform
        if platform.system() == 'Windows':
            try:
                from ctypes import windll
                try:
                    windll.shcore.SetProcessDpiAwareness(2)
                except:
                    try:
                        windll.user32.SetProcessDPIAware()
                    except:
                        pass
            except:
                pass
    except:
        pass
    
    root = tk.Tk()
    root.withdraw()
    root.attributes('-topmost', True)
    
    try:
        root.tk.call('tk', 'scaling', 2.0)
    except:
        pass
    
    # 选择数据库文件
    file_path = filedialog.askopenfilename(
        title="选择数据库文件",
        filetypes=[
            ("数据库文件", "*.db;*.ta;*.la;*.pa"),
            ("All files", "*.*")
        ]
    )
    try:
        root.iconbitmap('icon.ico')
    except:
        pass
    root.destroy()
    return file_path

@app.route('/api/select-file', methods=['POST'])
def select_file():
    """选择单个数据库文件"""
    result = [None]
    def target():
        result[0] = open_file_dialog()
    
    t = threading.Thread(target=target)
    t.start()
    t.join()
    
    path = result[0]
    if path:
        return jsonify({'path': path})
    return jsonify({'path': None})

@app.route('/api/file-info', methods=['POST'])
def get_file_info():
    """获取文件的所有表信息"""
    file_path = request.json.get('path')
    
    if not file_path or not os.path.exists(file_path):
        return jsonify({'error': 'File not found'}), 404
    
    try:
        conn = get_db_connection(file_path)
        cursor = conn.cursor()
        
        # 获取所有表
        cursor.execute("SELECT name FROM sqlite_master WHERE type='table';")
        tables = [row['name'] for row in cursor.fetchall()]
        
        # 排除系统表
        tables = [t for t in tables if t not in ['android_metadata', 'sqlite_sequence']]
        
        conn.close()
        
        return jsonify({
            'fileName': os.path.basename(file_path),
            'filePath': file_path,
            'tables': tables
        })
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@app.route('/api/analyze-structure', methods=['POST'])
def analyze_structure_api():
    """Run structure analysis on the selected folder"""
    folder_path = request.json.get('path')
    
    if not folder_path:
        return jsonify({'error': 'Path is required'}), 400
    
    folder_path = folder_path.strip('"\'')
    if not os.path.exists(folder_path):
        return jsonify({'error': 'Path does not exist'}), 400
        
    try:
        # Run the analysis
        result = analyze_database_structure(folder_path)
        return jsonify(result)
    except Exception as e:
        return jsonify({'error': str(e)}), 500



@app.route('/api/ollama/status', methods=['GET'])
def get_ollama_status():
    global OLLAMA_AVAILABLE
    OLLAMA_AVAILABLE = ollama_service.check_ollama_status()
    return jsonify({'available': OLLAMA_AVAILABLE})

@app.route('/api/ollama/models', methods=['GET'])
def get_models():
    if not OLLAMA_AVAILABLE:
        # Try checking again just in case it started
        if ollama_service.check_ollama_status():
            return jsonify({'models': ollama_service.get_available_models()})
        return jsonify({'error': 'Ollama service is not running'}), 503
    
    models = ollama_service.get_available_models()
    return jsonify({'models': models})

def get_context_data(file_path, route_code=None, geo_point=None):
    """
    Fetch related geological data based on RouteCode and GeoPoint.
    """
    if not file_path or not os.path.exists(file_path):
        return None
    
    context = {}
    try:
        conn = get_db_connection(file_path)
        cursor = conn.cursor()
        
        # Get all table names
        cursor.execute("SELECT name FROM sqlite_master WHERE type='table'")
        tables = [row['name'] for row in cursor.fetchall()]
        
        for table in tables:
            if table in ['android_metadata', 'sqlite_sequence']:
                continue
                
            # Check if table has ROUTECODE or GEOPOINT fields
            cursor.execute(f"PRAGMA table_info({table})")
            columns = [info[1].upper() for info in cursor.fetchall()]
            
            query_parts = []
            params = []
            
            if route_code and 'ROUTECODE' in columns:
                query_parts.append("ROUTECODE = ?")
                params.append(route_code)
                
            if geo_point and 'GEOPOINT' in columns:
                query_parts.append("GEOPOINT = ?")
                params.append(geo_point)
            
            if query_parts:
                where_clause = " AND ".join(query_parts)
                # Limit to prevent token overflow, e.g. 5 records per table if only route, 1 if precise point
                limit = 5 if not geo_point else 1
                sql = f"SELECT * FROM {table} WHERE {where_clause} LIMIT {limit}"
                
                cursor.execute(sql, params)
                rows = cursor.fetchall()
                if rows:
                    context[table] = [dict(row) for row in rows]
        
        conn.close()
    except Exception as e:
        print(f"Error fetching context: {e}")
    
    return context

@app.route('/api/ollama/query', methods=['POST'])
def query_ollama():
    if not OLLAMA_AVAILABLE:
        return jsonify({'error': 'Ollama service is not running'}), 503
    
    data = request.json
    if not data:
        return jsonify({'error': 'Invalid JSON body'}), 400
        
    model = data.get('model')
    prompt = data.get('prompt')
    
    # Safely get context, defaulting to empty dict if missing OR None
    context = data.get('context') or {}
    file_path = context.get('filePath')
    route_code = context.get('routeCode')
    geo_point = context.get('geoPoint')
    
    # 1. Build Geological Context
    context_data = None
    if file_path:
        context_data = get_context_data(file_path, route_code, geo_point)
    
    # 2. Build Full Prompt
    full_prompt = ollama_service.build_geological_prompt(prompt, context_data, GLOBAL_SCHEMA_CACHE)
    
    # 3. Stream Response
    def generate():
        ollama_response = ollama_service.query_ollama(model, full_prompt, stream=True)
        if isinstance(ollama_response, str):
            yield ollama_response
            return

        try:
            for line in ollama_response.iter_lines():
                if line:
                    json_response = json.loads(line)
                    token = json_response.get('response', '')
                    if token:
                        yield token
        except Exception as e:
            yield f"Error streaming: {str(e)}"

    return Response(generate(), mimetype='text/plain')


def resolve_table_name(file_path, input_name):
    """
    Robustly resolve table name from input (which might be a filename or hallucination).
    """
    # 1. Verification: If table exists as-is, return it.
    if file_has_table(file_path, input_name):
        return input_name
        
    # 2. Heuristic: Check against Geological Categories (Reverse Lookup)
    input_lower = input_name.lower()
    for category, data in GEOLOGICAL_CATEGORIES.items():
        for rule in data.get('rules', []):
            pattern = rule.get('file_pattern', '').lower()
            # If input matches pattern (e.g. 'Sample.ta' matches 'Sample.ta' or '*.db' matches 'Note.db' - wait, wildcard match?)
            # Case A: Exact filename match (e.g. input='Sample.ta', pattern='Sample.ta')
            if pattern == input_lower:
                return rule.get('table')
            
            # Case B: Input is just the category name (e.g. input='Sample', pattern='Sample.ta')
            # This handles "Update Sample table" -> resolves to 'GeoArea'
            if pattern.startswith(input_lower + '.'):
                return rule.get('table')

    # 3. Fallback: Extension based
    if input_lower.endswith(('.ta', '.la', '.pa')):
        return 'GeoArea'
        
    return input_name

@app.route('/api/ollama/execute', methods=['POST'])
def execute_actions():
    data = request.json
    actions = data.get('actions')
    file_path = data.get('filePath')
    
    if not actions:
        return jsonify({'error': 'Missing actions'}), 400
        
    # File path is optional for SEARCH, but required for UPDATE
    if any(a.get('type') != 'SEARCH' for a in actions) and (not file_path or not os.path.exists(file_path)):
         return jsonify({'error': 'File not found for modification'}), 404
        
    count = 0
    debug_log = []
    
    # Store search results
    search_results = []
    
    try:
        # Separate connection for Updates (single file) vs Search (global)
        conn = None
        if file_path and os.path.exists(file_path):
            conn = get_db_connection(file_path)
            cursor = conn.cursor()
        
        for action in actions:
            action_type = action.get('type', '').upper()
            table = action.get('table')
            
            if action_type == 'SEARCH':
                filter_criteria = action.get('filter')
                if not table: continue
                
                debug_log.append(f"SEARCHing for {table} with {filter_criteria}")
                
                # Search all known DB files
                global GLOBAL_DB_FILES
                # If no global files (e.g. no scan done), try current file
                targets = GLOBAL_DB_FILES if GLOBAL_DB_FILES else ([file_path] if file_path else [])
                
                for target_db in targets:
                    try:
                        # Resolve Table Name per file
                        actual_table = resolve_table_name(target_db, table)
                        
                        # Quick check if table exists
                        if not file_has_table(target_db, actual_table):
                            continue
                            
                        s_conn = get_db_connection(target_db)
                        s_cursor = s_conn.cursor()
                        
                        # Build Query
                        sql = f"SELECT * FROM {actual_table}"
                        values = []
                        if filter_criteria:
                            where_parts = []
                            for k, v in filter_criteria.items():
                                # Handle wildcard '*' -> Treat as "Match Any" (ignore this condition)
                                if str(v).strip() == '*':
                                    continue
                                where_parts.append(f"{k} LIKE ?") # Use LIKE for broader search
                                values.append(f"%{v}%")
                            if where_parts:
                                sql += " WHERE " + " AND ".join(where_parts)
                        
                        sql += " LIMIT 20" # Safety limit per file
                        
                        s_cursor.execute(sql, values)
                        rows = s_cursor.fetchall()
                        s_conn.close()
                        
                        if rows:
                            for row in rows:
                                res = dict(row)
                                res['_source'] = os.path.basename(target_db)
                                search_results.append(res)
                            debug_log.append(f"Found {len(rows)} in {os.path.basename(target_db)}")
                    except Exception as e:
                        debug_log.append(f"Error searching {target_db}: {e}")
                
                continue

            row_data = action.get('data')
            if not table or not row_data:
                continue
                
            # [Systemic Fix] Resolve Table Name
            original_table = table
            table = resolve_table_name(file_path, table)
            if table != original_table:
                 debug_log.append(f"Resolved table '{original_table}' to '{table}'")
            
            if action_type == 'UPDATE':
                # Case 1: ID based update
                row_id = action.get('id')
                # Case 2: Filter based update (WHERE clause)
                filter_criteria = action.get('filter')
                
                if row_id:
                    pk_col = get_table_primary_key(conn, table)
                    if not pk_col:
                        debug_log.append(f"Skipped UPDATE on {table}: Could not determine Primary Key")
                        continue
                        
                    set_clause = ", ".join([f"{k} = ?" for k in row_data.keys()])
                    values = list(row_data.values())
                    values.append(row_id)
                    
                    sql = f"UPDATE {table} SET {set_clause} WHERE {pk_col} = ?"
                    cursor.execute(sql, values)
                    
                    if cursor.rowcount > 0:
                        count += cursor.rowcount
                        debug_log.append(f"UPDATE {table}: Modified {cursor.rowcount} row(s) (PK: {pk_col}={row_id})")
                    else:
                        debug_log.append(f"UPDATE {table}: No rows found for {pk_col}='{row_id}'")
                
                elif filter_criteria is not None:
                    # Construct WHERE clause from filter
                    where_parts = []
                    filter_values = []
                    
                    for k, v in filter_criteria.items():
                        # Handle wildcard '*' -> Treat as "Match Any" (ignore this condition)
                        if str(v).strip() == '*':
                            debug_log.append(f"Filter wildcard on {k} detected, treating as ANY")
                            continue
                        
                        where_parts.append(f"{k} = ?")
                        filter_values.append(v)
                    
                    set_clause = ", ".join([f"{k} = ?" for k in row_data.keys()])
                    values = list(row_data.values()) + filter_values
                    
                    if not where_parts:
                         # Case 1: Filter was explicit empty dict {} -> Update All
                         # Case 2: Filter had only wildcards -> Update All
                         sql = f"UPDATE {table} SET {set_clause}"
                         debug_log.append(f"Applying UPDATE to ALL rows (Filter was empty or wildcard)")
                    else:
                        where_clause = " AND ".join(where_parts)
                        sql = f"UPDATE {table} SET {set_clause} WHERE {where_clause}"
                    
                    cursor.execute(sql, values)
                    
                    if cursor.rowcount > 0:
                        count += cursor.rowcount
                        debug_log.append(f"BATCH UPDATE {table}: Modified {cursor.rowcount} row(s)")
                    else:
                        debug_log.append(f"BATCH UPDATE {table}: No rows match criteria")
                    
                else:
                    debug_log.append(f"Skipped UPDATE on {table}: No ID or Filter provided")
                    continue
                
            elif action_type == 'INSERT':
                cols = ", ".join(row_data.keys())
                placeholders = ", ".join(["?" for _ in row_data])
                values = list(row_data.values())
                
                sql = f"INSERT INTO {table} ({cols}) VALUES ({placeholders})"
                cursor.execute(sql, values)
                count += 1
                debug_log.append(f"INSERT {table}: Success")
                
        if conn:
            conn.commit()
            conn.close()
            
        return jsonify({
            'success': True, 
            'count': count, 
            'debug': debug_log,
            'search_results': search_results
        })
        
    except Exception as e:
        if conn:
            conn.rollback()
            conn.close()
        return jsonify({'error': str(e), 'debug': debug_log}), 500

if __name__ == '__main__':
    # Initial check
    print("Checking Ollama status...")
    try:
        OLLAMA_AVAILABLE = ollama_service.check_ollama_status()
        print(f"Ollama Available: {OLLAMA_AVAILABLE}")
    except Exception as e:
        print(f"Ollama Check Failed: {e}")

    import webbrowser
    from threading import Timer
    
    def open_browser():
        webbrowser.open('http://127.0.0.1:5000')
        
    Timer(1.5, open_browser).start()
    app.run(debug=False, port=5000)
