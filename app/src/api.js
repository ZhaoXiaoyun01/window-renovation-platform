export async function api(path,body){
 const options=body===undefined?{}:body instanceof FormData?{method:'POST',body}:{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)};
 const r=await fetch('/api'+path,options);const data=await r.json();
 if(!r.ok)throw new Error(typeof data.detail==='string'?data.detail:'输入数据无效，请检查数值与字段。');return data;
}
export const fields=[['water','水密压力','Pa',10],['uw','整窗 K / Uw','W/(m²·K)',0.01],['opening','开启方式','内开 / 外开'],['tempered','钢化玻璃','是 / 否'],['sound_rw','整窗隔声量 Rw','dB',0.1],['air_grade','气密等级','级',1],['seal_count','密封道数','道',1],['thickness','铝材公称壁厚','mm',0.1],['thermal','隔热条材质','例如 PA66-GF25'],['strip_width','隔热条宽度','mm',0.1],['glass','玻璃配置','例如 5+12A+5 Low-E'],['seal','胶条材质','例如 EPDM'],['hardware','五金品牌型号','填写具体品牌与型号'],['shgc','整窗 SHGC','0–1',0.01],['wind','抗风压 P3','kPa',0.1],['price','综合单价','元/m²',1]];
export const blank=()=>({name:'我的门窗项目',version:0,city:'广州',scene:'住宅装修',product:'铝合金外窗',exposure:'未确定',orientation:'未确定',height:null,specs:{},targets:{seal_count:3},documents:[],reviewed_documents:[],evidence:{}});
export const cities='广州 深圳 珠海 佛山 东莞 中山 惠州 江门 肇庆 汕头 潮州 揭阳 汕尾 湛江 茂名 阳江 韶关 清远 河源 梅州 云浮'.split(' ');
