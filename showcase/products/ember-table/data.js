export const dishes = [
 {id:'cabbage',name:'Fire-roasted cabbage',price:18,description:'A generous wedge, charred at the edges. Lemon tahini, cider dressing, parsley and olive-oil sourdough crumbs.',kind:'Vegan recipe',ingredients:'Wheat / gluten, sesame'},
 {id:'carrots',name:'Ember carrots',price:16,description:'Sweet, smoky carrots over whipped white beans, finished with a hazelnut crunch.',kind:'Vegan recipe',ingredients:'Hazelnuts / tree nuts'},
 {id:'barley',name:'Mushroom & barley bowl',price:24,description:'Mushrooms and pearl barley in vegetable broth, with parsley and a butter finish.',kind:'Vegetarian recipe',ingredients:'Barley / gluten, milk'},
 {id:'chicken',name:'Roast chicken',price:29,description:'Golden roast chicken, lemon-butter pan juices and a tangle of bitter leaves.',kind:'From the hearth',ingredients:'Milk'},
 {id:'trout',name:'Wood-roasted trout',price:31,description:'A wood-roasted trout fillet with crushed potatoes and caper butter.',kind:'From the hearth',ingredients:'Fish, milk'},
 {id:'pear',name:'Poached pear',price:11,description:'Soft pear, oat-and-wheat crumble, vanilla cream and a little poaching syrup.',kind:'Vegetarian recipe',ingredients:'Oats, wheat / gluten, milk'}
];
export const drinks = [
 {name:'Roasted apple & rosemary spritz',price:7,description:'Apple juice, rosemary syrup and soda water.'},
 {name:'Lemon verbena iced tea',price:6,description:'Brewed lemon verbena, lemon and a light sugar syrup.'},
 {name:'Tart cherry soda',price:7,description:'Cherry juice, lemon and soda water.'}
];
export const tables=[2,2,2,2,4,4,6,6];
export function dateInPortland(now=new Date()) { return new Intl.DateTimeFormat('en-CA',{timeZone:'America/Los_Angeles',year:'numeric',month:'2-digit',day:'2-digit'}).format(now); }
export function addDays(date,days) { const d=new Date(date+'T12:00:00Z');d.setUTCDate(d.getUTCDate()+days);return d.toISOString().slice(0,10); }
export function dateValid(date,min,max) { const d=new Date(date+'T12:00:00Z');return /^\d{4}-\d{2}-\d{2}$/.test(date)&&!Number.isNaN(d.getTime())&&d.toISOString().slice(0,10)===date&&date>=min&&date<=max; }
export function exampleSittings(date,service,party) {
 const d=new Date(date+'T12:00:00Z');const day=d.getUTCDay();
 if(party>6)return {message:'Parties of 7 or more are outside this online demonstration. We do not assume that tables can be joined.',slots:[]};
 if(day===1||day===2)return {message:'The kitchen is closed on Monday and Tuesday. Choose Wednesday to Sunday.',slots:[]};
 if(service==='lunch'&&day!==0)return {message:'Lunch is served on Sunday only. Choose Sunday or switch to dinner.',slots:[]};
 const times=service==='lunch'?['12:00','12:30','13:00']:['17:30','18:00','19:15','19:45',...([5,6].includes(day)?['20:15']:[])];
 const seed=Math.floor(d.getTime()/86400000);
 const now=new Date();const localTime=new Intl.DateTimeFormat('en-GB',{timeZone:'America/Los_Angeles',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).format(now);
 const future=times.filter(time=>date!==dateInPortland(now)||time>localTime);
 if(!future.length)return {message:'This service has no example sittings left today. Choose another date or service.',slots:[]};
 const slots=times.map((time,i)=>({time,tables:tables.filter((_,j)=>(seed+i*3+j)%5>1)})).filter(slot=>future.includes(slot.time)&&slot.tables.some(seats=>seats>=party)).map(({time})=>time);
 return {message:slots.length?`${slots.length} example sittings fit your party. These are synthetic table patterns, not live availability.`:'No example table fits this combination. Try another date or party size. No tables have been held.',slots};
}
