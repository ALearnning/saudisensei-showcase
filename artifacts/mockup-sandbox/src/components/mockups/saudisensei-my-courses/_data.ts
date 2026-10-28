import type { Course } from "../saudisensei-dashboard/_shared";

export const longTitles = {
  ar: "أساسيات تصميم واجهات المستخدم وتجارب التعلّم الرقمية المتقدمة",
  en: "Designing Accessible Interfaces for Modern Web Applications",
};

export const manyCourses: Course[] = [
  { id: "mc-01", title: "أساسيات تصميم واجهات المستخدم", description: "من الفكرة إلى واجهة واضحة. تعلّم مبادئ التصميم وبناء تجارب رقمية أفضل.", progress: { completedRequired: 7, totalRequired: 12, percentage: 58, isCompleted: false, continueLessonId: "lesson-08" } },
  { id: "mc-02", title: "Modern Web Development", description: "Build a strong foundation in the tools and principles of the modern web.", progress: { completedRequired: 3, totalRequired: 10, percentage: 30, isCompleted: false, continueLessonId: "lesson-04" } },
  { id: "mc-03", title: "مهارات التفكير وحل المشكلات", description: "خطوات عملية لفهم التحديات، وتنظيم الأفكار، والوصول إلى حلول أفضل.", progress: { completedRequired: 8, totalRequired: 8, percentage: 100, isCompleted: true } },
  { id: "mc-04", title: "مبادئ تجربة المستخدم", description: "اكتشف كيف تضع احتياجات المستخدم في قلب كل قرار تصميمي.", progress: { completedRequired: 2, totalRequired: 9, percentage: 22, isCompleted: false, continueLessonId: "lesson-03" } },
  { id: "mc-05", title: "Writing for Digital Products", description: "Make every interface word clear, useful, and easy to understand.", progress: { completedRequired: 5, totalRequired: 8, percentage: 63, isCompleted: false, continueLessonId: "lesson-06" } },
  { id: "mc-06", title: "مقدمة في تحليل البيانات", description: "حوّل الأرقام إلى أسئلة أفضل وقرارات أكثر وضوحاً.", progress: { completedRequired: 0, totalRequired: 6, percentage: 0, isCompleted: false } },
  { id: "mc-07", title: "Accessible Content Design", description: "Design content that works for more people, across more contexts.", progress: { completedRequired: 6, totalRequired: 6, percentage: 100, isCompleted: true } },
  { id: "mc-08", title: "التواصل والعمل ضمن فريق", description: "ممارسات يومية تساعد الفرق على التعاون بوضوح وثقة.", progress: { completedRequired: 4, totalRequired: 11, percentage: 36, isCompleted: false, continueLessonId: "lesson-05" } },
  { id: "mc-09", title: "Foundations of Product Thinking", description: "Learn to connect customer needs, product choices, and outcomes.", progress: { completedRequired: 1, totalRequired: 7, percentage: 14, isCompleted: false, continueLessonId: "lesson-02" } },
  { id: "mc-10", title: "أساسيات الأمن الرقمي", description: "خطوات أساسية لحماية الحسابات والبيانات في الاستخدام اليومي.", progress: { completedRequired: 7, totalRequired: 7, percentage: 100, isCompleted: true } },
  { id: "mc-11", title: "Visual Systems for the Web", description: "Build a consistent visual language with reusable design decisions.", progress: { completedRequired: 3, totalRequired: 12, percentage: 25, isCompleted: false, continueLessonId: "lesson-04" } },
  { id: "mc-12", title: "التفكير النقدي في بيئة العمل", description: "وازن بين الأدلة والافتراضات لصناعة قرارات مدروسة.", progress: { completedRequired: 4, totalRequired: 8, percentage: 50, isCompleted: false, continueLessonId: "lesson-05" } },
  { id: "mc-13", title: "Practical Research Methods", description: "Choose thoughtful research methods and make sense of what you learn.", progress: { completedRequired: 0, totalRequired: 0, percentage: 0, isCompleted: false } },
  { id: "mc-14", title: "مبادئ إدارة المشاريع", description: "خطّط للعمل، تابع التقدّم، ووضّح الخطوة التالية للفريق.", progress: { completedRequired: 9, totalRequired: 10, percentage: 90, isCompleted: false, continueLessonId: "lesson-10" } },
  { id: "mc-15", title: "Data Storytelling Essentials", description: "Turn analysis into a clear narrative people can act on.", progress: { completedRequired: 5, totalRequired: 5, percentage: 100, isCompleted: true } },
  { id: "mc-16", title: "مهارات العرض والتقديم", description: "نظّم أفكارك وقدّمها بطريقة واضحة ومقنعة.", progress: { completedRequired: 1, totalRequired: 5, percentage: 20, isCompleted: false, continueLessonId: "lesson-02" } },
];

export function localizedTitle(course: Course, locale: "ar" | "en", index: number, long: boolean) {
  if (long && index === 0) return longTitles[locale];
  if (long && index === 1) return locale === "ar"
    ? "التطوير الحديث للويب: الأدوات والمبادئ التي تساعدك على بناء تجارب رقمية متينة"
    : "Modern Web Development: Tools and Principles for Building Thoughtful Digital Experiences";
  return course.title;
}

