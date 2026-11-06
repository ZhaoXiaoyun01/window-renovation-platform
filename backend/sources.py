import json
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
SOURCES=[
 {'id':'GDGUIDE2026','title':'广东省住宅工程“堵漏裂臭”问题防治技术指南（试行）','kind':'广东官方技术指南（指导性）','status':'发布通知、政策解读及外窗防渗漏章节已核实','url':'https://zfcxjst.gd.gov.cn/xxgk/wjtz/content/post_4914813.html','excerpt':'粤建质〔2026〕131号，2026-06-23。官方政策解读明确为指导性、操作性技术文件，应结合工程实际选择应用。附件1.2.1节，正文30—31页（PDF35—36页）列出密封胶相容、滴水构造、框墙缝隙有效密封、固定片内高外低、四角密封和排水孔等防渗漏措施；正文33页（PDF38页）的持续淋水24h属于运营期整治后验收要求，不推广为所有新装窗的统一强制要求。','checked_at':'2026-09-29'},
 {'id':'GDWINDOW','title':'DBJ/T 15-30-2022 铝合金门窗工程技术规范','kind':'广东地方规范线索','status':'2026官方指南引用已核实；规范原文和现行状态待核实','url':'https://zfcxjst.gd.gov.cn/attachment/0/617/617815/4914813.pdf','excerpt':'广东2026防治指南1.2.1节引用该规范5.3.2、6.4.3、6.4.4。仅证明官方指南引用了它，尚未取得其正式全文、替代关系及项目适用依据，不据此编造门窗性能阈值。','checked_at':'2026-09-29'},
 {'id':'GB8478','title':'GB/T 8478-2020 铝合金门窗','kind':'推荐性国家标准','status':'官方现行状态及列明条文已核实','url':'https://openstd.samr.gov.cn/bzgk/std/newGbInfo?hcno=D4CF94C76957350B9EDFFA0D8767504E','verified_clause':True,'excerpt':'官方全文预览第11页（正文第6页）：5.1.2.1.1 主要受力杆件公称壁厚应经设计计算和试验确定；5.1.2.1.2 门窗用主型材基材公称壁厚（附件功能槽口翅壁除外）外门不小于2.2mm、外窗不小于1.8mm。达到数值不能替代结构计算。第12页（正文第7页）：5.1.3.1 外门窗用中空玻璃气体层不小于9.0mm；5.1.5.1 密封胶须具有相容性和粘结性；5.1.5.4 胶条按环境及功能选择并考虑相容性和污染性；5.1.6 五金须满足整樘承载与反复启闭耐久要求。','checked_at':'2026-09-29'},
 {'id':'GDENERGY','title':'广东省居住建筑节能设计标准 / GB 55015-2021 建筑节能与可再生能源利用通用规范','kind':'地方标准与强制性工程规范线索','status':'修订计划已核实；现行条文及项目适用性待核实','url':'https://zfcxjst.gd.gov.cn/','excerpt':'已读取省住建厅2023-04-24行动计划，明确提出修订 DBJ/T 15-133-2018。这不是新版发布公告，不能确认2018版仍适用。需核对最新版本、实施日期、废止替代关系，并结合国家通用规范、建筑类型、气候分区、窗墙比、遮阳设计确定项目要求。不得用截图中的 K＜3.0 替代审核。','checked_at':'2026-09-29'},
 {'id':'GB55001','title':'GB 55001-2021 工程结构通用规范','kind':'强制性工程规范线索','status':'适用条文待核实','url':'https://www.mohurd.gov.cn/','excerpt':'结构设计需核对荷载、构件、连接和安装条件。当前平台不计算风荷载，不出具承载力或结构安全结论。','checked_at':'2026-09-29'},
 {'id':'GLASS','title':'建筑玻璃应用与安全玻璃要求','kind':'规范线索','status':'项目适用条文待核实','url':'https://www.mohurd.gov.cn/','excerpt':'应核对安全玻璃适用位置、尺寸和安装条件及相关有效规范。没有原文和适用条件时只提出补证，不编造条号或阈值。','checked_at':'2026-09-29'},
 {'id':'EXP','title':'平台选购核对清单 1.0','kind':'经验建议（非博主原话）','status':'平台整理，非规范结论','url':'','excerpt':'广东选窗建议同时核对遮阳与整窗性能、迎风暴露、排水与安装、五金耐腐蚀、胶条老化、部件品牌型号及合同可追溯性。经验不是简单把所有数值提高，不能绕过适用条件。','checked_at':'2026-09-29'},
 {'id':'SCREENSHOT','title':'用户提供的广东配置截图','kind':'用户资料 / 经验候选','status':'原文已读；结论未核实','url':'','excerpt':'截图主张 K＜3.0、隔热条大于14.8mm、5+9+5Low-E 等可满足标准，并给出24mm超低能耗建议。原图未给标准编号、条文、建筑条件或检测数据，因此不进入硬性判定。','checked_at':'2026-09-29'},
 {'id':'HC521','title':'HC521/zhuangxiu','kind':'开源架构参考','status':'README 已读取；未复制项目代码','url':'https://github.com/HC521/zhuangxiu','excerpt':'借鉴现象、危害、标准、验收、风险等级、规范级别、国标编号的结构化组织方式；不继承其未经复核的知识结论。','checked_at':'2026-09-29'},
 {'id':'ZX029','title':'zx029w/zhuangxiu-skills 门窗封窗避坑指南','kind':'开源工作流参考','status':'README 与门窗 SKILL.md 已读取；会员来源正文未导入','url':'https://github.com/zx029w/zhuangxiu-skills/tree/main/menchuang-fengchuang-bikeng-zhinan','excerpt':'借鉴按窗型、密封、五金、安装与验收分主题提问、指出风险与补证方向的工作流。该 Skill 明示其内容整理自西安会员知识库，不能直接当成广东地方标准、已核实的产品事实或自由可复制的本地经验库。模型仅引用平台内已核实的公开来源。','checked_at':'2026-09-29'},
 {'id':'PYWIN','title':'LBNL-ETA/pyWinCalc','kind':'后续热工计算候选','status':'仓库存在已核实；尚未集成计算','url':'https://github.com/LBNL-ETA/pyWinCalc','excerpt':'后续可评估专业玻璃热工计算；1.0 不根据玻璃配置猜测 Uw、SHGC 或隔声值。','checked_at':'2026-09-29'}]

def get_sources():
    result=[dict(s) for s in SOURCES]
    path=ROOT/'research'/'videos.json'
    if path.exists(): result.extend(json.loads(path.read_text(encoding='utf-8')))
    return result
