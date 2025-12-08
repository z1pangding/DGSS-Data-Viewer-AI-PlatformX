"""
地质分类映射配置
定义如何将文件和数据表映射到地质分类
包含字段映射字典，用于AI理解字段含义
"""

GEOLOGICAL_CATEGORIES = {
    '地质点': {
        'icon': '📍',
        'en_name': 'Geological Points',
        'rules': [
            {
                'file_pattern': 'Gpoint.ta',
                'table': 'GeoArea',
                'description': '地质观察点',
                'fields': {
                    'ROUTECODE': '路线号', 'GEOPOINT': '地质点号', 'XX': 'X坐标', 'YY': 'Y坐标',
                    'ALTITUDE': 'Z坐标', 'LOCATION': '位置说明', 'GEOMORPH': '微地貌', 'TYPE': '点性',
                    'OUTCROP': '露头', 'WEATHING': '风化程度', 'STRAPHA': '填图单位A', 'STRAPHB': '填图单位B',
                    'STRAPHC': '填图单位C', 'LITHO_A': '岩石名称A', 'LITHO_B': '岩石名称B', 'LITHO_C': '岩石名称C',
                    'STRARAB': '接触关系A/B', 'STRARBC': '接触关系B/C', 'STRARAC': '接触关系A/C'
                }
            },
            {
                'file_pattern': '*.db',
                'table': 'GPOINT',
                'description': '地质点文字描述',
                'fields': { 'GEOPOINT': '地质点号', 'DESC': '地质点文字描述', 'DESC_PZ': '描述批注' }
            }
        ]
    },
    '地质线路': {
        'icon': '🛤️',
        'en_name': 'Routes',
        'rules': [
            {
                'file_pattern': '*.db',
                'table': 'ROUTE',
                'description': '路线基本信息',
                'fields': { 'ROUTECODE': '路线号', 'DESC': '路线小结', 'ROUTE_JC': '路线检查批注' }
            },
            {
                'file_pattern': '*.db',
                'table': 'ROUTING',
                'description': '路线追索线',
                'fields': { 'GEOPOINT': '地质点号', 'R_CODE': 'R编号', 'DESC': '路线描述', 'DESC_PZ': '描述批注' }
            },
            {
                'file_pattern': 'Groute.la',
                'table': 'GeoArea',
                'description': '野外路线基本信息',
                'fields': {
                    'ROUTECODE': '路线号', 'DATE': '日期', 'HANDMAP': '图幅号', 'WEATHER': '天气',
                    'DESCRIBE': '路线说明', 'TASK': '任务描述', 'RECORDER': '记录者',
                    'FELLOW': '同行者', 'CAMERAMAN': '摄影者'
                }
            }
        ]
    },
    '地质界线': {
        'icon': '〰️',
        'en_name': 'Boundaries',
        'rules': [
            {
                'file_pattern': 'Boundary.la',
                'table': 'GeoArea',
                'description': '地质界线',
                'fields': {
                    'ROUTECODE': '路线号', 'GEOPOINT': '地质点号', 'SUBPOINT': 'B编号', 'R_CODE': 'R编号',
                    'RIGHT_BODY': '右侧填图单位', 'LEFT_BODY': '左侧填图单位', 'TYPE': '界线类型',
                    'RELATION': '接触关系', 'TREND': '界线走向', 'DIP': '界面倾向', 'DIP_ANG': '界面倾角'
                }
            },
            {
                'file_pattern': '*.db',
                'table': 'BOUNDARY',
                'description': '界线描述',
                'fields': { 'B_CODE': '界线编号', 'GEOPOINT': '地质点号', 'DESC': '界线描述', 'DESC_PZ': '描述批注' }
            }
        ]
    },
    '产状': {
        'icon': '📐',
        'en_name': 'Attitudes',
        'rules': [
            {
                'file_pattern': 'Attitude.ta',
                'table': 'GeoArea',
                'description': '产状测量点',
                'fields': {
                    'ROUTECODE': '路线号', 'GEOPOINT': '地质点号', 'CODE': 'B编号', 'R_CODE': 'R编号',
                    'XX': 'X坐标', 'YY': 'Y坐标', 'ALTITUDE': 'Z高程', 'DIP': '倾向',
                    'DIP_ANG': '倾角', 'TREND': '走向', 'TYPE': '产状类型', 'STRAPH': '填图单位'
                }
            }
        ]
    },
    '照片': {
        'icon': '📷',
        'en_name': 'Photos',
        'rules': [
            {
                'file_pattern': 'Photo.ta',
                'table': 'GeoArea',
                'description': '照片数据',
                'fields': {
                    'ROUTECODE': '路线号', 'GEOPOINT': '地质点号', 'CODE': '照片编号', 'R_CODE': 'R编号',
                    'XX': 'X坐标', 'YY': 'Y坐标', 'AMOUNT': '照片数', 'DIRECTION': '镜头方向',
                    'DESCRIBE': '照片内容', 'NUMBER': '数码序号'
                }
            }
        ]
    },
    '样品': {
        'icon': '🧪',
        'en_name': 'Samples',
        'rules': [
            {
                'file_pattern': 'Sample.ta',
                'table': 'GeoArea',
                'description': '样品采集点',
                'fields': {
                    'ROUTECODE': '路线号', 'GEOPOINT': '地质点号', 'CODE': '样品编号', 'R_CODE': 'R编号',
                    'XX': 'X坐标', 'YY': 'Y坐标', 'SAMPLER': '采样人', 'TYPE': '样品类别',
                    'GEOUNIT': '采样层位', 'NAME': '样品岩性', 'LOCATION': '采样地点',
                    'WEIGHT': '样品重量', 'BLOCKS': '块（袋）数', 'DEPTH': '采样深度', 'DATE': '采样日期'
                }
            }
        ]
    }
}
