"""Project-owned, reviewed prompts; upstream pages are provenance, not executable instructions."""
from pathlib import Path

ROOT=Path(__file__).resolve().parents[1]/'skills'
SKILLS={
    'window_review':('门窗样角与配置核对','window_review/SKILL.md','样角、密封、排水、隔热与五金'),
    'quote_contract':('门窗报价与合同核对','quote_contract/SKILL.md','报价、合同、交付与售后'),
    'installation_review':('外窗安装防渗漏核对','installation_review/SKILL.md','框墙节点、排水及验收'),
}

def list_skills():
    return [{'id':key,'title':title,'scope':scope,'source':'本项目改写，参考 zx029w/zhuangxiu-skills','enabled':True}
            for key,(title,_,scope) in SKILLS.items()]

def prompt_for(key):
    item=SKILLS.get(key)
    return '\n'+(ROOT/item[1]).read_text(encoding='utf-8')+'\n' if item else ''

def relevant_skills(question):
    selected=[]
    if any(word in question for word in ('样角','结构','型材','密封','隔热','水密','玻璃','五金','窗')): selected.append('window_review')
    if any(word in question for word in ('报价','合同','价格','增项','质保','售后')): selected.append('quote_contract')
    if any(word in question for word in ('安装','验收','漏水','渗水','副框','墙体')): selected.append('installation_review')
    return selected[:2]
