// Illustrative learning content only. No identity, private media or application requests.
export const sampleChapters = [
  { title:"الأساسيات التي تصنع الفرق", en:"Foundations that make a difference", lessons:[
    {title:"فكّر بالأنواع قبل كتابة الكود",en:"Think in types before writing code",kind:"text",done:true},
    {title:"بناء مكوّنات بواجهات واضحة",en:"Building components with clear interfaces",kind:"video",done:true},
  ]},
  {title:"من الفكرة إلى تطبيق عملي", en:"From idea to working code",lessons:[
    {title:"كتابة دوال آمنة باستخدام TypeScript",en:"Writing safer functions with TypeScript",kind:"video",done:false},
    {title:"الأنواع المركّبة وحالات الاستخدام",en:"Union types and real use cases",kind:"text",done:false},
    {title:"تطبيق عملي: واجهة بيانات المستخدم",en:"Practice: a user data interface",kind:"text",done:false},
  ]},
  {title:"اجمع ما تعلّمته",en:"Bring it all together",lessons:[
    {title:"مراجعة المشروع والخطوة التالية",en:"Project review and the next step",kind:"video",done:false},
  ]}
];
export const illustrativeCode = `type Learner = {
  name: string;
  completedLessons: number;
};

function welcome(learner: Learner): string {
  return \`Welcome, \${learner.name}\`;
}

const learner: Learner = {
  name: "Sara",
  completedLessons: 2,
};

console.log(welcome(learner));`;
