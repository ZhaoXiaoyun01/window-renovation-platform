import type { PurchaseRule } from '../types';
export const defaultPurchaseRule = (paint=false): PurchaseRule => ({ reservePercent:paint?0:5,piecesPerBox:1,fullBoxes:false });
export function validatePurchaseRule(rule: PurchaseRule) {
  if(!rule||!Number.isFinite(rule.reservePercent)||rule.reservePercent<0||rule.reservePercent>100||Math.abs(rule.reservePercent*100-Math.round(rule.reservePercent*100))>1e-7||!Number.isInteger(rule.piecesPerBox)||rule.piecesPerBox<1||rule.piecesPerBox>10000||typeof rule.fullBoxes!=='boolean')throw new Error('预留比例须为0–100%（最多两位小数），每箱1–10000片。');
  return {...rule};
}
export function purchaseQuantity(tiles:number,rule=defaultPurchaseRule()) {
  validatePurchaseRule(rule);
  const reserved=Math.ceil(tiles*(10000+Math.round(rule.reservePercent*100))/10000),boxes=rule.fullBoxes?Math.ceil(reserved/rule.piecesPerBox):0;
  return {reserved,boxes,purchase:rule.fullBoxes?boxes*rule.piecesPerBox:reserved};
}
export function purchaseExplanation(tiles:number,rule=defaultPurchaseRule(),paintArea?:number){
 const {reserved,boxes,purchase}=purchaseQuantity(tiles,rule),percent=rule.reservePercent;
 if(paintArea!==undefined)return `${paintArea.toFixed(3)}㎡ × (1＋${percent}%) = ${(paintArea*(1+percent/100)).toFixed(3)}㎡；不推定桶数`;
 const raw=tiles*(10000+Math.round(percent*100))/10000;
 return `${tiles}片 × (1＋${percent}%) = ${Number(raw.toFixed(4))}片 → 向上取整${reserved}片；${rule.fullBoxes?`每箱${rule.piecesPerBox}片，${reserved}÷${rule.piecesPerBox}向上取整${boxes}箱 → 采购${purchase}片`:`散片采购${purchase}片（箱规${rule.piecesPerBox}片/箱，未启用整箱）`}`;
}
