import sqlite3
import os

def analyze_database_structure(db_path):
    """
    Analyzes the SQLite database and returns a summary string of its structure.
    Used to give the AI a 'Global Map' of the data.
    """
    if not os.path.exists(db_path):
        return f"Database not found: {db_path}"

    summary = []
    try:
        conn = sqlite3.connect(db_path)
        cursor = conn.cursor()
        
        # Get all tables
        cursor.execute("SELECT name FROM sqlite_master WHERE type='table';")
        tables = cursor.fetchall()
        
        summary.append(f"Database File: {os.path.basename(db_path)}")
        summary.append(f"Total Tables: {len(tables)}")
        
        for table_row in tables:
            table_name = table_row[0]
            # Skip internal SQLite tables
            if table_name.startswith('sqlite_'):
                continue
                
            summary.append(f"\nTable: {table_name}")
            
            # Get columns
            cursor.execute(f"PRAGMA table_info({table_name})")
            columns = cursor.fetchall()
            col_names = [col[1] for col in columns]
            pk_col = next((col[1] for col in columns if col[5] == 1), "None")
            
            summary.append(f"  - Primary Key: {pk_col}")
            summary.append(f"  - Columns: {', '.join(col_names)}")
            
        conn.close()
        return "\n".join(summary)
        
    except Exception as e:
        return f"Error analyzing database structure: {str(e)}"
