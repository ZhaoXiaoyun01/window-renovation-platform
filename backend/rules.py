"""Deterministic checks. Missing data never passes; standard applicability is explicit."""
from datetime import datetime, timezone
import re

LABELS={'opening':'开启方式','tempered':'钢化玻璃','sound_rw':'隔声量 Rw','air_grade':'气密等级','seal_count':'密封道数','thickness':'铝材公称壁厚','thermal':'隔热条材质','strip_width':'隔热条宽度','glass':'玻璃配置','seal':'胶条材质','hardware':'五金品牌型号','uw':'整窗 K/Uw','shgc':'整窗 SHGC','wind':'抗风压 P3','water':'水密压力','price':'综合单价'}

def evaluate(project, sources):
    p=project.model_dump() if hasattr(project,'model_dump') else project
    s,t=p['specs'],p['targets']; rows=[]
    def add(id,layer,title,status,detail,advice,source):
        rows.append(dict(id=id,layer=layer,title=title,status=status,detail=detail,advice=advice,source=source))
    # GB/T is a recommended product standard, never relabelled a mandatory law.
    threshold={'铝合金外窗':1.8,'铝合金外门':2.2}.get(p['product'])
    verified=next((x.get('verified_clause',False) for x in sources if x['id']=='GB8478'),False)
    val=s.get('thickness')
    status='未确定' if val is None or threshold is None or not verified else ('参数达到' if val>=threshold else '低于标准值')
    add('profile','硬性规范','主型材基材公称壁厚',status,
        f"{p['product']}；录入值：{val if val is not None else '未确定'} mm。GB/T 8478-2020 是推荐性产品标准，采用时按相应要求核对。不是所有部位壁厚，也不是结构安全结论。",
        f"依据 5.1.2.1.2，{p['product']}主型材基材公称壁厚不小于 {threshold} mm（附件功能槽口翅壁除外）；5.1.2.1.1 同时要求主要受力杆件经设计计算和试验确定。录入值达到仅代表该参数数值达到。" if threshold else '先确认材质与门/窗、内/外分类。','GB8478')
    glass=(s.get('glass') or '').strip()
    match=re.fullmatch(r'\s*\d+(?:\.\d+)?\s*\+\s*(\d+(?:\.\d+)?)\s*(?:A|Ar)\s*\+\s*\d+(?:\.\d+)?\s*(?:Low[- ]?E)?\s*',glass,re.I)
    gap=float(match.group(1)) if match and threshold else None
    add('glass_gap','硬性规范','外门窗中空玻璃气体层','未确定' if gap is None or not verified else '低于标准值' if gap<9 else '参数达到',
        f"录入玻璃：{glass or '未确定'}。"+(f'按双玻单腔描述读取气体层 {gap} mm。' if gap is not None else '组合未能明确识别为双玻单腔，不猜测气体层。'),
        'GB/T 8478-2020 第5.1.3.1条要求外门窗用中空玻璃气体层厚度不小于9.0mm。本项按用户确认的名义组合核对，实测偏差及玻璃安全另核；三玻、夹胶等复杂组合需人工确认。','GB8478')
    for key,title,clause,advice in [
        ('seal_compatible','密封胶相容性与粘结性','5.1.5.1','提供密封胶与接触基材的相容性及粘结性证明。'),
        ('hardware_match','五金承载与耐久匹配','5.1.6','核对整樘门窗承载要求、五金型号和反复启闭耐久性；仅填写品牌不足以判断。')]:
        v=s.get(key,'未确定')
        add(key,'硬性规范',title,'未确定' if v=='未确定' or threshold is None or not verified else '记录满足，待核证' if v=='是' else '记录不满足',f'用户核对记录：{v}。依据 GB/T 8478-2020 第{clause}条。',advice,'GB8478')
    for id,title,detail,advice,source in [
        ('energy','广东节能适用性','不能把广东统一简化为 K＜3.0；隔热条宽度和玻璃组合不能直接推出整窗 Uw。','补充建筑设计阶段、气候分区、窗墙面积比、遮阳条件及项目节能设计指标；核对整窗报告。','GDENERGY'),
        ('structure','抗风压与玻璃结构安全','厚型材、加厚玻璃或某一系列名称不能证明整窗结构安全。','提供城市、安装高度、地形、窗尺寸、分格、连接与锚固设计；由专业人员按适用规范校核。','GB55001'),
        ('safety','安全玻璃及防坠落','安全玻璃适用性与安装位置、尺寸、用途有关；检测报告需匹配本次产品。','补充玻璃构成、尺寸、安装高度及防护设计；向商家索取可核验的安全玻璃与五金资料。','GLASS'),
        ('report','检测报告与实际产品一致性','报告编号或上传文件本身不等于检测结果适用于当前门窗。','核对样品型号、尺寸、开启方式、玻璃、型材、五金、检测机构和报告真伪。','GB8478')]:
        add(id,'硬性规范',title,'未确定',detail,advice,source)
    add('heat','经验建议','广东夏季隔热与遮阳','建议核对',
        f"朝向：{p['orientation']}。优先核对整窗 SHGC、Uw 和外遮阳；不能仅比较 Low-E 层数或隔热条宽度。",
        '西晒场景优先比较太阳得热与遮阳方案，同时权衡采光；不设无依据的全省统一阈值。','EXP')
    add('weather','经验建议','风雨、排水与安装','重点核对' if p['exposure']=='沿海/迎风' else '建议核对',
        f"暴露条件：{p['exposure']}。水密检测值不等于安装后永不漏水。",
        '要求出示排水路径、框墙防水、固定点、密封胶相容性和验收方案；沿海另核五金耐腐蚀资料。','EXP')
    add('gd_install','经验建议','广东官方指南：外窗防渗漏','建议核对' if threshold else '未确定',
        '已核实广东2026技术指南1.2.1节。它是指导性文件，具体措施需结合项目；当前没有现场施工证据，不能判定安装符合。',
        '向安装方索取框墙密封、滴水构造、四角密封、排水孔和固定片节点图及隐蔽验收照片。指南正文30—31页要求密封条压实平顺、关闭接触严密；正文33页的持续淋水24h针对运营期整治后验收，不能当成所有新装窗的统一强制门槛。','GDGUIDE2026')
    for key,title,advice in [('thermal','隔热条可追溯性','明确材质、品牌、批次及检测依据；不以燃烧、颜色等简单方法替代检测。'),('seal','胶条与角部密封','明确胶条材质、接角工艺、压缩配合和老化检测；关注更换维修。'),('hardware','五金匹配与维护','在合同中写明品牌和具体型号，核对承重、扇尺寸适用范围及防坠落措施；“进口五金”不是型号。'),('glass','玻璃组合与实际性能','分别核对安全、隔热、隔声需求；三玻不必然比双玻隔声好，要求对应整窗报告。')]:
        add('exp_'+key,'经验建议',title,'未确定' if not s.get(key) else '建议核对',f"商家配置：{s.get(key) or '未确定'}。",advice,'EXP')
    for key,advice,source in [
        ('opening','核对实际开启方向、限位、五金与防坠落设计；图像不清时以样角和设计图为准。','EXP'),
        ('tempered','核对钢化标识、相应检测资料及该安装位置是否要求安全玻璃。','GLASS'),
        ('sound_rw','应取得相同构造的整窗隔声检测报告；玻璃层数不能直接代替隔声值。','EXP'),
        ('air_grade','核对气密检测报告与本项目设计要求；不能仅由密封道数推定。','GB8478'),
        ('seal_count','三道密封是用户偏好；要确认三条密封路径确实连续、相互配合，不能仅数胶条。','EXP'),
        ('uw','整窗 K/Uw 值需对应相同框型、玻璃、尺寸和检测条件；不能从隔热条宽度推断。','GDENERGY'),
        ('water','优先核对整窗水密检测压力、样品构造和现场安装排水；没有项目适用阈值时不判达标。','GDGUIDE2026'),
        ('wind','核对抗风压报告及城市、安装高度、窗尺寸和锚固设计。','GB55001'),
        ('shgc','核对整窗太阳得热系数及朝向、外遮阳与采光要求。','GDENERGY')]:
        actual=s.get(key)
        add('dimension_'+key,'经验建议',LABELS[key],'未确定' if actual in (None,'','未确定') else '待核对',
            f"商家录入：{actual if actual not in (None,'') else '未确定'}。尚未取得该项目可直接适用的统一阈值或对应检测证据。",advice,source)
    for key,target in t.items():
        if target is None or target=='': continue
        actual=s.get(key)
        if actual is None or actual=='': status='未确定'
        elif isinstance(target,(int,float)): status='达到需求' if (actual<=target if key in ('uw','shgc','price') else actual>=target) else '不满足需求'
        else: status='文本一致' if actual.strip().casefold()==target.strip().casefold() else '需核对差异'
        add('target_'+key,'用户需求',LABELS[key],status,f'目标：{target}；商家：{actual if actual not in (None,"") else "未确定"}。',
            '数值仅基于已确认录入值比较；字符串仅核对书面描述，不能证明等效性能。未达需求时要求商家更新配置并重新报价。','USER')
    issues=sum(x['status'] in ('不满足需求','低于标准值','记录不满足') for x in rows)
    unknown=sum(x['status']=='未确定' for x in rows)
    summary=f'发现 {issues} 项已确认参数差距；另有 {unknown} 项未确定。' if issues else f'已核对项目中未发现明确差距；仍有 {unknown} 项未确定。'
    return dict(rule_version='1.3',created_at=datetime.now(timezone.utc).isoformat(),summary=summary+' 不构成整窗合规或结构安全结论。',results=rows,unknown=unknown,issues=issues)
