"""Reviewer-facing reference cells: only verified numbers are shown as numbers."""


def get_references(product='铝合金外窗'):
    wall={'铝合金外窗':'主型材基材公称壁厚≥1.8 mm（GB/T 8478-2020 5.1.2.1.2）',
          '铝合金外门':'主型材基材公称壁厚≥2.2 mm（GB/T 8478-2020 5.1.2.1.2）'}.get(product,'产品分类待确认')
    common='具体项目限值未核实；核对设计要求及同型号检测报告。'
    data={k:{'national':common,'local':'广东项目适用条文及数值待核实。'} for k in
          ('opening','tempered','sound_rw','air_grade','seal_count','thickness','thermal','strip_width','glass','seal','hardware','uw','shgc','wind','water','price')}
    data['thickness']['national']=wall
    data['glass']['national']='若为外门窗中空玻璃，气体层≥9.0 mm（GB/T 8478-2020 5.1.3.1）'
    data['seal_count']['national']='未核实通用强制道数；三道密封属于当前用户选购偏好。'
    data['water']['national']='水密检测值须结合项目设计；没有已核实的全国统一适用压力值。'
    data['uw']['national']='整窗传热系数须结合建筑节能设计；未核实可直接套用的统一限值。'
    data['uw']['local']='广东项目适用节能条文及 K 值待核实，不能直接写成全省 K＜3.0。'
    data['water']['local']='广东2026防渗漏指南1.2.1节为指导性施工建议；具体水密指标待项目设计核对。'
    data['opening']['national']='开启方式须与设计和防坠落要求匹配；无统一优劣排序。'
    data['tempered']['national']='安全玻璃适用位置及构造须按项目核对；不是所有位置一律钢化。'
    data['price']={'national':'产品标准不规定商家综合单价。','local':'不适用；核对报价范围和合同计价条款。'}
    return data
