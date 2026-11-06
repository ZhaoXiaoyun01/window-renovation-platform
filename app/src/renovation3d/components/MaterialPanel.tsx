import { useEffect, useMemo, useRef, useState, type Dispatch, type SetStateAction } from 'react';
import { Upload, Layers, Save, Pencil } from 'lucide-react';
import { editableBuildingFaces } from '../utils/model-surfaces';
import { buildingConfig as config } from '../config/building-config';
import { faceFinishRegions, faceMetrics, resolveFaceFinish } from '../utils/wall-surfaces';
import { importTileStyle, materialDraft, materialPrice, sameMaterial, matchesTileStyle, replaceFaces, replaceSameMaterial, tileStyleName, styleFingerprint, styleChanged } from '../utils/finish-actions';
import { readTileImage, validateState } from '../utils/validation';
import { tileDimensions, validateTile } from '../tile-layout/layout';
import { createTileStyle, listTileStyles, renameTileStyle } from '../store/styles-api';
import type { TileQuantity } from '../utils/tile-quantities';
import { ColorPicker } from './ColorPicker';
import { TileQuantityPanel } from './TileQuantityPanel';
import type { Finish, RenovationState, TileMaterial, TileStyle, WallFace } from '../types';

type Draft = Omit<Finish, 'widthMm' | 'heightMm' | 'groutMm'> & { widthMm: string; heightMm: string; groutMm: string };
const asDraft = (finish: Finish): Draft => ({ ...finish, widthMm: String(finish.widthMm), heightMm: String(finish.heightMm), groutMm: String(finish.groutMm) });
const metres = (value: number) => (value / 1000).toFixed(3).replace(/\.?0+$/, '');
const textureLabels = { plain: '纯色', stone: '石纹', concrete: '水泥纹', custom: '上传图片' };
const colorSwatch = (color: string) => <span className="r3d-swatch" style={{ backgroundColor: color }}/>;
const allFaces = editableBuildingFaces();
const money = (value: number) => value.toLocaleString('zh-CN', { maximumFractionDigits: 2 });
function draftFinish(draft: Draft, materialId: string): Finish {
  if ([draft.widthMm, draft.heightMm, draft.groutMm].some(value => !value.trim())) throw new Error('请填写完整的瓷砖规格与砖缝宽度。');
  const finish = { ...draft, materialId, widthMm: Number(draft.widthMm), heightMm: Number(draft.heightMm), groutMm: Number(draft.groutMm), preserveZoning: false };
  validateTile(finish);
  return finish;
}

export function MaterialPanel({ state, setState, targets, selectedFace, objectLabel, objectSize, selectedObject, onMessage, scopeLabel, stats, rangeQuantities, allQuantities, highlightedMaterial, onHighlight }: {
  highlightedMaterial: string; onHighlight: (id: string) => void;
  state: RenovationState; setState: Dispatch<SetStateAction<RenovationState>>; targets: WallFace[]; selectedFace?: WallFace;
  objectLabel: string; objectSize?: number[]; selectedObject: string; onMessage: (message: string) => void; scopeLabel: string;
  stats: { tiles: number; cuts: number; area: number; narrow: number };
  rangeQuantities: TileQuantity[]; allQuantities: TileQuantity[];
}) {
  const activeFace = selectedFace ?? targets[0];
  const actual = activeFace ? resolveFaceFinish(activeFace, state) : { ...config.defaultTile, materialId: state.materials[0].id };
  const actualMaterial = state.materials.find(material => material.id === actual.materialId)!;
  const defaultMaterial = selectedFace ? config.materials.find(material => material.id === selectedFace.zones[0].materialId)! : undefined;
  const metrics = useMemo(() => selectedFace ? faceMetrics(selectedFace) : undefined, [selectedFace]);
  const actualRegions = useMemo(() => selectedFace ? faceFinishRegions(selectedFace, state).map(region => ({ ...region, area: faceMetrics(region.face).netAreaMm2 / 1e6 })) : [], [selectedFace, state.finishes, state.faceFinishes, state.faceRegionFinishes]);
  const [draft, setDraft] = useState<Draft>(() => asDraft(actual)), [busy, setBusy] = useState(false), [tint, setTint] = useState(actualMaterial.color);
  const [sourceMaterialId, setSourceMaterialId] = useState(actual.materialId), [error, setError] = useState(''), [price, setPrice] = useState(String(materialPrice(actualMaterial)));
  const [styles, setStyles] = useState<TileStyle[]>([]), [styleBusy, setStyleBusy] = useState(false), [customStyleName, setCustomStyleName] = useState<string>();
  const [library, setLibrary] = useState<'preset' | 'custom'>('preset');
  const [sourceName, setSourceName] = useState(actualMaterial.name);
  const [baseline, setBaseline] = useState(() => styleFingerprint(actualMaterial, actual));
  const [selectionBaseline, setSelectionBaseline] = useState(() => styleFingerprint(actualMaterial, actual));
  const savingStyle = useRef(false);
  const [renaming, setRenaming] = useState<string>(), [renameName, setRenameName] = useState('');
  useEffect(() => { setDraft(asDraft(actual)); setTint(actualMaterial.color); setSourceMaterialId(actual.materialId); setPrice(String(materialPrice(actualMaterial))); setError(''); setCustomStyleName(undefined); setSourceName(actualMaterial.name); setBaseline(styleFingerprint(actualMaterial, actual)); setSelectionBaseline(styleFingerprint(actualMaterial, actual)); }, [activeFace?.id, scopeLabel]);
  const replacementChanged = styleFingerprint(actualMaterial, actual) !== selectionBaseline;
  const material = state.materials.find(item => item.id === draft.materialId) ?? actualMaterial;
  const paint = material.kind === 'paint';
  const generatedName = tileStyleName({ name: sourceName }, styles);
  const dirty = styleChanged(baseline, { ...material, color: tint, pricePerM2: Number(price) }, { ...draft, widthMm: Number(draft.widthMm), heightMm: Number(draft.heightMm), groutMm: Number(draft.groutMm) }, customStyleName, sourceName, generatedName);
  const renameDirty = !!renameName.trim() && renameName.trim() !== styles.find(style => style.id === renaming)?.name;
  const latest = useRef(state), mounted = useRef(true); latest.current = state;
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => { void listTileStyles().then(items => { if (mounted.current) setStyles(items); }).catch(failure => { if (mounted.current) onMessage(failure instanceof Error ? failure.message : '样式库读取失败。'); }); }, []);
  useEffect(() => {
    setLibrary(config.materials.some(item => item.id === actualMaterial.id && sameMaterial(item, actualMaterial)) ? 'preset' : 'custom');
  }, [activeFace?.id, actualMaterial.id]);
  const appliedStyles = new Set(styles.filter(style => (actualRegions.length ? actualRegions : [{ finish: actual }]).some(({ finish }) => {
    const sample = state.materials.find(item => item.id === finish.materialId)!;
    return matchesTileStyle(sample, finish, style);
  })).map(style => style.id));
  async function renameStyle(event: React.FormEvent) {
    event.preventDefault();
    if (!renaming || !renameDirty || styleBusy) return;
    setStyleBusy(true);
    try {
      const saved = await renameTileStyle(renaming, renameName.trim());
      if (!mounted.current) return;
      setStyles(items => items.map(item => item.id === saved.id ? saved : item)); setRenaming(undefined);
      onMessage(`材料已重命名为「${saved.name}」，历史方案与铺贴参数保持。`);
    } catch (failure) { if (mounted.current) onMessage(failure instanceof Error ? failure.message : '样式重命名失败。'); }
    finally { if (mounted.current) setStyleBusy(false); }
  }
  const sameCount = selectedFace ? allFaces.filter(face => faceFinishRegions(face, state).some(region => region.finish.materialId === actual.materialId)).length : 0;
  const matchingCount = selectedFace ? allFaces.filter(face => face.id === selectedFace.id || faceFinishRegions(face, state).some(region => region.finish.materialId === sourceMaterialId)).length : 0;
  function preview(nextDraft: Draft, nextTint = tint, base = state, sameMaterial = false, nextPrice = price) {
    if (sameMaterial && !replacementChanged) return;
    setDraft(nextDraft); setTint(nextTint);
    try {
      if (!nextPrice.trim()) throw new Error('请填写材料单价。');
      const replacement = materialDraft(base, nextDraft.materialId, nextTint, Number(nextPrice));
      const finish = base.materials.find(m => m.id === nextDraft.materialId)?.kind === 'paint'
        ? { ...config.defaultTile, materialId: replacement.finish.materialId, preserveZoning: false } : draftFinish(nextDraft, replacement.finish.materialId);
      const prepared = replacement.state;
      const bulk = sameMaterial && selectedFace ? replaceSameMaterial(prepared, allFaces, sourceMaterialId, selectedFace.id, finish) : undefined;
      const next = bulk?.state ?? replaceFaces(prepared, targets, finish);
      const referenced = new Set([...Object.values(next.finishes), ...Object.values(next.faceFinishes ?? {}), ...Object.values(next.faceRegionFinishes ?? {})].map(f => f.materialId));
      next.materials = next.materials.filter(m => !m.id.startsWith('draft-') || referenced.has(m.id) || m.id === replacement.finish.materialId);
      if(next.purchaseRules)next.purchaseRules=Object.fromEntries(Object.entries(next.purchaseRules).filter(([id])=>next.materials.some(m=>m.id===id)));
      setState(validateState(next)); setDraft({ ...nextDraft, materialId: replacement.finish.materialId }); setError('');
      if (bulk) {
        setSourceMaterialId(finish.materialId); setSelectionBaseline(styleFingerprint(prepared.materials.find(m => m.id === finish.materialId)!, finish));
        onMessage(`已替换全楼原同材质的${bulk.count}个面。保存方案以保留修改。`);
      }
    } catch (failure) { setError(failure instanceof Error ? failure.message : '参数无法预览。'); }
  }
  const update = (patch: Partial<Draft>) => preview({ ...draft, ...patch });
  async function saveStyle() {
    if (!dirty || busy || styleBusy || error || savingStyle.current) return;
    savingStyle.current = true; setStyleBusy(true);
    try {
      const replacement = materialDraft(latest.current, draft.materialId, tint, Number(price)), id = `custom-${crypto.randomUUID()}`;
      const finish = paint ? { ...config.defaultTile, materialId: id, preserveZoning: false } : draftFinish(draft, id);
      const name = (customStyleName ?? tileStyleName({ name: sourceName }, styles)).trim();
      if (!name || name.length > 80) throw new Error('样式名称须为1至80个字符。');
      const sample = { ...replacement.state.materials.find(m => m.id === replacement.finish.materialId)!, id, name };
      const existing = styles.find(style => styleFingerprint(style.material, style.finish) === styleFingerprint(sample, finish));
      if (existing) {
        setLibrary('custom'); setSourceName(existing.name); setBaseline(styleFingerprint(existing.material, existing.finish)); setCustomStyleName(undefined);
        onMessage(`相同材料已存在，复用「${existing.name}」，未重复存储。`); return;
      }
      const saved = await createTileStyle(name, sample, finish);
      if (!mounted.current) return;
      setStyles(items => [saved, ...items.filter(item => item.id !== saved.id)]); setLibrary('custom'); setSourceName(saved.name); setBaseline(styleFingerprint(saved.material, saved.finish)); setCustomStyleName(undefined); onMessage(`已保存或复用自定义「${saved.name}」，相同参数仅保存一份。`);
    } catch (failure) { if (mounted.current) onMessage(failure instanceof Error ? failure.message : '样式保存失败。'); }
    finally { savingStyle.current = false; if (mounted.current) setStyleBusy(false); }
  }
  function applyStyle(style: TileStyle) {
    try {
      const imported = importTileStyle(state, style), selectedMaterial = imported.state.materials.find(m => m.id === imported.finish.materialId)!;
      setBaseline(styleFingerprint(selectedMaterial, imported.finish)); setCustomStyleName(undefined); setSourceName(style.name); setPrice(String(materialPrice(selectedMaterial)));
      preview(asDraft(imported.finish), selectedMaterial.color, imported.state, false, String(materialPrice(selectedMaterial)));
    } catch (failure) { onMessage(failure instanceof Error ? failure.message : '样式无法应用。'); }
  }
  function chooseSample(sample: TileMaterial) {
    const imported = importTileStyle(state, { material: sample, finish: { ...config.defaultTile, materialId: sample.id } });
    setBaseline(styleFingerprint(sample, imported.finish)); setPrice(String(materialPrice(sample))); setCustomStyleName(undefined); setSourceName(sample.name);
    preview(asDraft(imported.finish), sample.color, imported.state, false, String(materialPrice(sample)));
  }
  function updatePrice(value: string) {
    setPrice(value);
    if (!value.trim() || !Number.isFinite(Number(value)) || Number(value) < 0 || Number(value) > 1000000) { setError('请输入0至1000000元/m²的材料单价。'); return; }
    preview(draft, tint, state, false, value);
  }
  async function upload(file?: File) {
    if (!file) return;
    setBusy(true);
    try {
      const uploaded = await readTileImage(file);
      if (!mounted.current) return;
      if (latest.current.materials.length >= config.scene.maxMaterials) throw new Error(`最多保存${config.scene.maxMaterials}个材质样例。`);
      setState(current => ({ ...current, materials: [...current.materials, uploaded] }));
      setDraft(current => ({ ...current, materialId: uploaded.id })); setTint(uploaded.color); setPrice('0'); setLibrary('custom'); setCustomStyleName(undefined); setSourceName(uploaded.name); setError('');
      onMessage('图片已添加到自定义草稿。设置规格后点击「保存到自定义」，图片和参数一起写入本地数据库。');
    } catch (error) { onMessage(error instanceof Error ? error.message : '图片读取失败。'); }
    finally { if (mounted.current) setBusy(false); }
  }
  return <>
    <section className="r3d-face-info">
      <h2 data-selected-object={selectedObject}>{selectedFace ? '面信息' : objectLabel ? '对象信息' : '请选择一个面'}</h2>
      {objectLabel ? <p className="r3d-subtle">{objectLabel}</p> : <p className="r3d-subtle">点击外露面，查看尺寸并更换材料。</p>}
      {selectedFace && new Set(selectedFace.members.map(member => member.viewGroup ?? 'floor')).size > 1 ? <p className="r3d-subtle">此面连接楼层与露台区域，更换材料将统一整个面；显示开关仍可分别控制。</p> : null}
      {metrics && selectedFace && defaultMaterial ? <><dl className="r3d-metric-cards">
        <div><dt>净面积</dt><dd>{(metrics.netAreaMm2 / 1e6).toFixed(2)} <small>m²</small></dd></div>
        <div><dt>外周长</dt><dd>{metres(metrics.outerPerimeterMm)} <small>m</small></dd></div>
        <div><dt>长度（包络）</dt><dd>{metres(metrics.widthMm)} <small>m</small></dd></div>
        <div><dt>宽度（包络）</dt><dd>{metres(metrics.heightMm)} <small>m</small></dd></div>
      </dl><dl className="r3d-info-grid">
        <div><dt>洞口周长</dt><dd>{metres(metrics.openingPerimeterMm)} m</dd></div>
        <div><dt>默认颜色</dt><dd>{colorSwatch(defaultMaterial.color)}{defaultMaterial.color.toUpperCase()}</dd></div>
        <div><dt>进退深度</dt><dd>{selectedFace.offsetMm} mm</dd></div>
      </dl></> : objectSize ? <><dl className="r3d-info-grid"><div><dt>宽 × 高{objectSize.length === 3 ? ' × 深' : ''}</dt><dd>{objectSize.map(metres).join(' × ')} m</dd></div></dl><p className="r3d-subtle">请选择装修面更换材料。</p></> : null}
    </section>
    <TileQuantityPanel purchaseRules={state.purchaseRules} scopeRows={rangeQuantities} allRows={allQuantities} materials={state.materials} selectedFinish={activeFace ? actual : undefined} scopeLabel={scopeLabel} key={selectedFace?.id ?? scopeLabel}>
    {targets.length && !paint ? <section className="r3d-layout-summary"><h3>范围排砖</h3><div><span>净铺贴面</span><strong>{stats.area.toFixed(2)} m²</strong></div><div><span>需裁切原砖格</span><strong>{stats.cuts}</strong></div><div><span>短边不足100mm片段</span><strong>{stats.narrow}</strong></div></section> : null}
    {selectedFace ? <section className="r3d-applied-material"><h3>实际材料</h3>
        {actualRegions.length > 1 ? <p className="r3d-subtle">现有方案包含{actualRegions.length}种铺贴；替换后统一此面。</p> : null}
        {actualRegions.map(({ finish, area }, index) => {
          const appliedMaterial = state.materials.find(item => item.id === finish.materialId)!;
          return <div key={index} className={actualRegions.length > 1 ? 'r3d-current-finish' : undefined}>
            {actualRegions.length > 1 ? <h3>铺贴 {index + 1}<small>{area.toFixed(2)} m²</small></h3> : null}
            <dl className="r3d-info-grid">
              <div><dt>面层材料</dt><dd>{colorSwatch(appliedMaterial.color)}{appliedMaterial.name}</dd></div>
              {appliedMaterial.kind === 'paint' ? <div><dt>涂刷方式</dt><dd>连续纯色漆面 · 无砖格</dd></div> : <><div><dt>纹理 / 规格</dt><dd>{textureLabels[appliedMaterial.texture]} · {finish.widthMm} × {finish.heightMm} mm</dd></div>
              <div><dt>方向 / 起铺</dt><dd>{finish.direction === 'horizontal' ? '长边横铺' : '长边竖铺'} · {finish.alignment === 'edge' ? '墙角' : '居中'}</dd></div>
              <div><dt>模型砖格</dt><dd>横向{tileDimensions(finish).width} × 竖向{tileDimensions(finish).height} mm</dd></div>
              <div><dt>砖缝</dt><dd>{finish.groutMm} mm {colorSwatch(finish.groutColor)}{finish.groutColor.toUpperCase()}</dd></div></>}
              <div><dt>估算单价</dt><dd>¥{money(materialPrice(appliedMaterial))}/m²</dd></div>
            </dl>
          </div>;
        })}
    </section> : null}
    </TileQuantityPanel>
    <section><h3>替换材料 <small>{scopeLabel} · {targets.length} 个面</small></h3>
      <div className="r3d-material-tabs" role="tablist" aria-label="材料分类"><button role="tab" aria-selected={library === 'preset'} onClick={() => setLibrary('preset')}>预设</button><button role="tab" aria-selected={library === 'custom'} onClick={() => setLibrary('custom')}>自定义 <small>{styles.length}</small></button></div>
      <div className="r3d-materials" aria-label={library === 'preset' ? '预设材料' : '自定义材料'}>
        {library === 'preset' ? config.materials.map(item => <button key={item.id} title={item.name} aria-label={`选择${item.name}`} aria-pressed={sameMaterial(material, item)} className={sameMaterial(material, item) ? 'selected' : ''} onClick={() => chooseSample(item)}><span style={{ backgroundColor: item.color }} data-texture={item.texture}/><div>{item.name}<small>¥{money(materialPrice(item))}/m²</small></div></button>) : <>
          {styles.map(style => <div className="r3d-material-card" key={style.id}><button aria-label={`使用自定义${style.name}`} aria-pressed={appliedStyles.has(style.id)} className={appliedStyles.has(style.id) ? 'selected' : ''} onClick={() => applyStyle(style)}><span style={{ backgroundColor: style.material.color, backgroundImage: style.material.image ? `url(${style.material.image})` : undefined }} data-texture={style.material.texture}/><div>{style.name}<small>¥{money(materialPrice(style.material))}/m² · 已保存</small></div></button><button className="r3d-material-rename" aria-label={`重命名材料${style.name}`} title="重命名" disabled={styleBusy} onClick={() => { setRenaming(style.id); setRenameName(style.name); }}><Pencil size={12}/></button></div>)}
          {state.materials.filter(item => !config.materials.some(preset => sameMaterial(preset, item)) && !styles.some(style => sameMaterial(style.material, item))).map(item => <button key={item.id} aria-label={`编辑草稿${item.name}`} aria-pressed={actual.materialId === item.id} className={actual.materialId === item.id ? 'selected' : ''} onClick={() => chooseSample(item)}><span style={{ backgroundColor: item.color, backgroundImage: item.image ? `url(${item.image})` : undefined }}/><div>{item.name}<small>方案内 · 待存入材料库</small></div></button>)}
        </>}
      </div>
      {renaming ? <form className="r3d-material-rename-form" onSubmit={event => void renameStyle(event)}><label>修改已保存材料名称<input aria-label="已保存材料名称" maxLength={80} value={renameName} onChange={event => setRenameName(event.target.value)} autoFocus/></label><div><button type="submit" disabled={styleBusy || !renameDirty}>保存名称</button><button type="button" disabled={styleBusy} onClick={() => setRenaming(undefined)}>取消重命名</button></div></form> : null}
      <p className="r3d-subtle">{library === 'preset' ? '预设固定。修改规格、颜色或价格后，可另存到自定义材料库。' : '已保存材料来自本地数据库，可跨方案使用；草稿需手动保存。'}</p>
      {!paint && <><label className="r3d-upload"><Upload size={15}/>{busy ? '读取图片中…' : '上传瓷砖图片'}<input aria-label="上传瓷砖图片" type="file" accept="image/png,image/jpeg,image/webp" disabled={busy} onChange={event => { void upload(event.target.files?.[0]); event.target.value = ''; }}/></label>
      <div className="r3d-two"><label>规格 A / mm<input aria-label="瓷砖规格A" type="number" min="20" max="2400" value={draft.widthMm} onChange={event => update({ widthMm: event.target.value })}/></label><label>规格 B / mm<input aria-label="瓷砖规格B" type="number" min="20" max="2400" value={draft.heightMm} onChange={event => update({ heightMm: event.target.value })}/></label></div></>}
      {!paint && <><div className="r3d-two"><label>铺贴方向<select aria-label="铺贴方向" value={draft.direction} onChange={event => update({ direction: event.target.value as Finish['direction'] })}><option value="horizontal">长边横铺</option><option value="vertical">长边竖铺</option></select></label><label>起铺方式<select aria-label="起铺方式" value={draft.alignment} onChange={event => update({ alignment: event.target.value as Finish['alignment'] })}><option value="edge">墙角起铺</option><option value="center">两侧均分</option></select></label></div>
      <div className="r3d-two"><label>砖缝 / mm<input aria-label="砖缝宽度" type="number" min="0" max="20" step="0.5" value={draft.groutMm} onChange={event => update({ groutMm: event.target.value })}/></label><ColorPicker label="砖缝颜色" value={draft.groutColor} onChange={groutColor => update({ groutColor })}/></div></>}
      <ColorPicker label={paint ? '漆面颜色' : '瓷砖颜色'} value={tint} onChange={color => preview(draft, color)}/>
      <label className="r3d-price-label">材料单价 / 元/m²<input aria-label="材料单价" type="number" min="0" max="1000000" step="0.01" value={price} onChange={event => updatePrice(event.target.value)}/></label>
      <div className="r3d-estimate"><span>材料估价</span><strong>¥{money(stats.area * materialPrice(material))}</strong></div>
      <p className="r3d-subtle">净面积 × 材料单价。初始价格为可修改的演示估算，不含人工、辅料及损耗；单价随方案保存。</p>
      <p className="r3d-live-note">{targets.length ? `实时预览 · ${targets.length}个面` : '选择可铺贴面后实时预览'} · 保存方案保留修改</p>
      {error ? <p className="r3d-input-error" role="status">{error} 模型保留上一次有效参数。</p> : null}
      {selectedFace ? <><button className="r3d-highlight" aria-pressed={highlightedMaterial === actual.materialId} onClick={() => onHighlight(highlightedMaterial === actual.materialId ? '' : actual.materialId)}>{highlightedMaterial === actual.materialId ? '取消同材质高亮' : `高亮全楼同材质 · ${sameCount}个面`}</button>
        <button className="r3d-apply" disabled={busy || !!error || !replacementChanged} onClick={() => preview(draft, tint, state, true)}><Layers size={15}/>替换全楼原同材质 · {matchingCount}个面</button></> : null}
      <div className="r3d-style-footer"><h3>保存为自定义</h3>
      <div className="r3d-style-save"><label>材料名称<input aria-label="材料样式名称" maxLength={80} value={customStyleName ?? generatedName} onChange={event => setCustomStyleName(event.target.value)}/></label><button className="r3d-style-button" disabled={busy || styleBusy || !!error || !dirty} onClick={() => void saveStyle()}><Save size={15}/>{styleBusy ? '保存中…' : '保存到自定义'}</button></div>
      <p className="r3d-subtle">{dirty ? '信息已修改，可保存完整材料与铺贴参数。' : '未修改，无需重复保存；修改参数或名称后可保存。'}材料库与方案分别保存。</p>
      </div>
    </section>
    <details className="r3d-evidence"><summary>尺寸依据</summary>{config.notes.map(note => <p key={note}>{note}</p>)}</details>
  </>;
}
