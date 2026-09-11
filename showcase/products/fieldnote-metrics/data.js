export const weeks = ['2026-08-31','2026-08-24'];
export const stores = [{id:'junction',name:'Junction'},{id:'riverside',name:'Riverside'},{id:'market',name:'Market'}];
export const categories = [{id:'home',name:'Home goods',color:'#35654f'},{id:'pantry',name:'Pantry',color:'#ae553c'},{id:'stationery',name:'Stationery',color:'#75608b'}];
export const products = [
  {sku:'HG-01',name:'Stoneware Mug',category:'home',price:18},
  {sku:'HG-02',name:'Cotton Tea Towel',category:'home',price:14},
  {sku:'PA-01',name:'House Blend 250g',category:'pantry',price:16},
  {sku:'PA-02',name:'Citrus Marmalade',category:'pantry',price:11},
  {sku:'ST-01',name:'Weekly Pad',category:'stationery',price:12},
  {sku:'ST-02',name:'Pocket Notebook',category:'stationery',price:8}
];
const observations = [
  [[32,22],[26,58],[48,29],[24,60],[35,18],[41,76]],
  [[22,46],[31,20],[56,35],[29,66],[21,39],[34,22]],
  [[40,25],[19,42],[36,68],[33,26],[28,63],[52,39]],
  [[28,49],[22,66],[43,47],[27,69],[31,42],[38,87]],
  [[25,59],[24,41],[49,73],[25,90],[18,51],[31,42]],
  [[34,65],[21,57],[39,76],[26,48],[23,77],[44,72]]
];
export const rows = observations.flatMap((values,index) => values.map(([units,closing],productIndex) => {
  const product=products[productIndex];
  return {id:String(index*6+productIndex+1).padStart(3,'0'),week:weeks[Math.floor(index/3)],store:stores[index%3].id,sku:product.sku,product:product.name,category:product.category,units,netSales:units*product.price,closing};
}));
export const money = value => new Intl.NumberFormat('en-CA',{style:'currency',currency:'CAD',maximumFractionDigits:0}).format(value);
export const selectedRows = (week=weeks[0],store='all',category='all') => rows.filter(row=>row.week===week&&(store==='all'||row.store===store)&&(category==='all'||row.category===category));
export const totals = values => values.reduce((total,row)=>({netSales:total.netSales+row.netSales,units:total.units+row.units,flags:total.flags+(row.closing<row.units?1:0)}),{netSales:0,units:0,flags:0});
export const csv = values => ['row_id,week_start,store,sku,product,category,units_sold,net_sales_cad,closing_units',...values.map(row=>[row.id,row.week,row.store,row.sku,row.product,row.category,row.units,row.netSales,row.closing].join(','))].join('\n');
