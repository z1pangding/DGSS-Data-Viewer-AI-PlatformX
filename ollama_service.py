import requests
import json


OLLAMA_BASE_URL = "http://localhost:11434"

def check_ollama_status():
    """Check if Ollama is running."""
    try:
        # Timeout set to 2 seconds to avoid hanging startup if offline
        response = requests.get(f"{OLLAMA_BASE_URL}", timeout=2)
        return response.status_code == 200
    except:
        return False

def get_available_models():
    """Get list of available models."""
    try:
        response = requests.get(f"{OLLAMA_BASE_URL}/api/tags", timeout=5)
        if response.status_code == 200:
            data = response.json()
            return [model['name'] for model in data.get('models', [])]
        return []
    except Exception as e:
        print(f"Error fetching models: {e}")
        return []


from geological_mapping import GEOLOGICAL_CATEGORIES

def get_mapping_definition():
    """
    Generates a readable mapping definition from GEOLOGICAL_CATEGORIES.
    """
    lines = []
    try:
        for category, data in GEOLOGICAL_CATEGORIES.items():
            lines.append(f"### {category} ({data.get('en_name', '')})")
            for rule in data.get('rules', []):
                file_pattern = rule.get('file_pattern')
                table = rule.get('table')
                desc = rule.get('description')
                lines.append(f"- 表名: {table} (对应文件: {file_pattern}) | 说明: {desc}")
                
                fields = rule.get('fields', {})
                field_strs = [f"{k}={v}" for k, v in fields.items()]
                lines.append(f"  字段: {'; '.join(field_strs)}")
            lines.append("")
            
        return "\n".join(lines)
    except Exception as e:
        print(f"Error parsing mapping definition: {e}")
        return "Error generating mapping definitions."

def build_geological_prompt(user_input, context_data=None, global_schema=""):
    mapping_text = get_mapping_definition()
    
    data_context_str = "无关联数据"
    if context_data:
        try:
            data_context_str = json.dumps(context_data, ensure_ascii=False, indent=2)
        except:
            data_context_str = str(context_data)

    prompt = f"""
[Role]
You are an expert geological field assistant.
Your goal is to help geologists analyze and manage field data based on the provided dictionary and context.

[Database Structure (Global Knowledge)]
{global_schema}

[Dictionary & Field Mappings]
{mapping_text}

[Current Data Context]
{data_context_str}

[User Instruction]
{user_input}

[Requirement]
1. Language: You MUST answer in Simplified Chinese (简体中文).
2. Thinking Process: Think silently. DO NOT output <thought> tags.
3. Response: 
   - If the user asks a question, answer efficiently in Chinese.
   - If you need to FIND data not in the current context, return:
   {{
      "thought": "I need to find points with specific lithology...",
      "actions": [
          {{
              "type": "SEARCH",
              "table": "TableName",
              "filter": {{ "ColumnName": "Value" }}
          }}
      ]
   }}

   - If the user wants to MODIFY or GENERATE data, you MUST return a JSON object:
   
   {{
      "thought": "Reasoning...",
      "actions": [
          {{
              "type": "UPDATE",
              "table": "TableName",
              "filter": {{ "ColumnName": "Value" }}, 
              "data": {{ "ColumnName": "NewValue" }}
          }},
          {{
              "type": "UPDATE",
              "table": "TableName",
              "id": "RowID",
              "data": {{ "ColumnName": "NewValue" }}
          }}
      ]
   }}

   - Use "id" ONLY if you know the exact Primary Key value.
   - Use "filter" if you need to update multiple rows based on a condition.
   - For "filter", if you want to update ALL rows, use empty filter "{{}}" or omit it. DO NOT use wildcard "*".
   - CRITICAL: Use the ACTUAL Table Name (e.g., 'GeoArea', 'GPOINT'), NOT the filename (e.g. 'Sample.ta'). Refer to the [Database Structure] section.

Example Format for Chat:
<thought>Analyzing...</thought>
你的回答...

Example Format for Modification:
<thought>User wants to update...</thought>
{{ "thought": "...", "actions": [...] }}
"""
    return prompt.strip()

def query_ollama(model, prompt, stream=False):
    """Send query to Ollama."""
    url = f"{OLLAMA_BASE_URL}/api/generate"
    payload = {
        "model": model,
        "prompt": prompt,
        "stream": stream
    }
    try:
        response = requests.post(url, json=payload, stream=stream)
        if stream:
            return response
        else:
            if response.status_code == 200:
                return response.json().get('response', '')
            else:
                return f"Error from Ollama: {response.text}"
    except Exception as e:
        return f"Error: {e}"
