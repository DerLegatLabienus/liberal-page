export type ConstitutionColor =
  | 'blue' | 'gold' | 'teal' | 'red' | 'green' | 'purple' | 'orange' | 'navy'

export interface ConstitutionChapterContent {
  title: string
  summary: string
  bullets: string[]
}

export interface ConstitutionChapter {
  key: string
  color: ConstitutionColor
  pdfPage: number
  he: ConstitutionChapterContent
  en: ConstitutionChapterContent
}

// Hebrew transcribed verbatim from the Likud constitution org-structure source.
// English is an unofficial convenience translation; the Hebrew text is authoritative.
export const CONSTITUTION_CHAPTERS: ConstitutionChapter[] = [
  {
    key: 'members', color: 'blue', pdfPage: 3,
    he: {
      title: 'חברי התנועה',
      summary: 'אזרח ישראלי מגיל 17, תושב הארץ, המזדהה עם מטרות התנועה. משלם דמי חבר שנתיים. בוחר ישירות את יושב ראש התנועה ואת צירי הוועידה.',
      bullets: [
        'תנאי חברות: אזרח ישראלי מגיל 17, תושב הארץ, המזדהה עם מטרות התנועה ומשלם דמי חבר שנתיים',
        'זכות בחירה: לאחר 16 חודשי חברות רצופים, החבר רשאי להצביע בבחירות פנימיות',
        'זכות להיבחר: לאחר 3 שנות חברות רצופות, החבר רשאי להתמודד על תפקידים',
        'הפסקת חברות: בית הדין רשאי להפסיק חברות בשל הפרת חוקה; לחבר זכות ערעור תוך 15 ימים',
        'יקיר התנועה: חבר מעל גיל 70 עם 25+ שנות פעילות — מעמד מיוחד בתנועה',
      ],
    },
    en: {
      title: 'Movement Members',
      summary: 'An Israeli citizen aged 17+, resident in Israel, who identifies with the movement’s goals and pays annual dues. Directly elects the movement chairman and the convention delegates.',
      bullets: [
        'Membership: Israeli citizen aged 17+, resident, identifies with the movement’s goals and pays annual dues',
        'Right to vote: after 16 consecutive months of membership, may vote in internal elections',
        'Right to be elected: after 3 consecutive years of membership, may run for office',
        'Termination: the Tribunal may terminate membership for charter violations; the member may appeal within 15 days',
        'Movement Honoree (Yakir): a member over 70 with 25+ years of activity — a special standing',
      ],
    },
  },
  {
    key: 'chairman', color: 'blue', pdfPage: 17,
    he: {
      title: 'יושב ראש התנועה',
      summary: 'נבחר ישירות ע״י כלל חברי התנועה, עומד בראש הוועידה והמרכז. מועמד הליכוד לכהונת ראש ממשלת ישראל, וממנה את ועדת הפיקוח.',
      bullets: [
        'בחירה ישירה: נבחר ע״י כלל חברי התנועה בבחירות אישיות, שוות וחשאיות',
        'מועמדות: נדרשים 500 חתימות תומכים מחברי התנועה להגשת מועמדות',
        'שיטת בחירה דו-סיבובית: סף 40% בסיבוב ראשון; אם אף מועמד לא עובר — סיבוב שני בין שני המובילים',
        'ועדת פיקוח: מפקחת על תהליך הבחירות, קובעת כללים ולוחות זמנים',
        'כללי תעמולה: גישה שווה לכל המועמדים, איסור שימוש בכספי ציבור, שקיפות פיננסית מלאה',
      ],
    },
    en: {
      title: 'Movement Chairman',
      summary: 'Directly elected by all movement members; heads the convention and the center. The Likud candidate for Prime Minister of Israel, and appoints the oversight committee.',
      bullets: [
        'Direct election: elected by all members in personal, equal and secret elections',
        'Candidacy: 500 supporting signatures from members are required to submit a candidacy',
        'Two-round system: 40% threshold in the first round; if no candidate passes, a runoff between the top two',
        'Oversight committee: supervises the election process, sets rules and timetables',
        'Campaign rules: equal access for all candidates, ban on using public funds, full financial transparency',
      ],
    },
  },
  {
    key: 'convention', color: 'blue', pdfPage: 9,
    he: {
      title: 'הוועידה — המוסד העליון',
      summary: 'המוסד העליון של התנועה — כ-2,500 צירים. קובעת את חוקת התנועה, בוחרת בית דין ומבקר. מתכנסת אחת ל-4 שנים.',
      bullets: [
        'הרכב: כ-2,500 צירים — 60% לפי שיוך סניפי, 40% לפי ספרי בוחרים',
        'תדירות: מתכנסת אחת ל-4 שנים, לפני בחירות לכנסת או לרשויות מקומיות',
        'סמכות עליונה: קובעת את חוקת התנועה, בוחרת בית דין ומבקר פנימי',
        'מייסדים: חברים מעל גיל 70, פעילים 30+ שנה — צירים אוטומטיים מכוח כהונה',
        'שיטת בחירות: כלליות, ישירות, שוות, חשאיות ויחסיות',
      ],
    },
    en: {
      title: 'The Convention — Supreme Body',
      summary: 'The supreme body of the movement — about 2,500 delegates. Sets the movement charter and elects the Tribunal and the auditor. Convenes once every 4 years.',
      bullets: [
        'Composition: ~2,500 delegates — 60% by branch affiliation, 40% by voter rolls',
        'Frequency: convenes once every 4 years, ahead of Knesset or local-authority elections',
        'Supreme authority: sets the movement charter, elects the Tribunal and the internal auditor',
        'Founders: members over 70, active 30+ years — automatic delegates by virtue of standing',
        'Election method: general, direct, equal, secret and proportional',
      ],
    },
  },
  {
    key: 'center', color: 'gold', pdfPage: 9,
    he: {
      title: 'המרכז — בין ועידה לוועידה',
      summary: 'מחליט בכל ענייני התנועה בין ועידה לוועידה, ורשאי לשנות החלטות ועידה ברוב חבריו. מתכנס לפחות אחת ל-6 חודשים.',
      bullets: [
        'סמכות: מחליט בכל ענייני התנועה בין ועידה לוועידה',
        'שינוי החלטות: רשאי לשנות החלטות ועידה ברוב חבריו',
        'ישיבה ראשונה: תוך 30 ימים מנעילת הוועידה',
        'תדירות: מתכנס לפחות אחת ל-6 חודשים',
        'סדר יום: נקבע ע״י יו״ר התנועה, ניתן לשינוי ברוב',
      ],
    },
    en: {
      title: 'The Center — Between Conventions',
      summary: 'Decides all movement matters between conventions, and may amend convention resolutions by a majority of its members. Convenes at least once every 6 months.',
      bullets: [
        'Authority: decides all movement matters between conventions',
        'Amending resolutions: may amend convention resolutions by a majority of its members',
        'First session: within 30 days of the convention’s close',
        'Frequency: convenes at least once every 6 months',
        'Agenda: set by the movement chairman, changeable by majority',
      ],
    },
  },
  {
    key: 'bureau', color: 'navy', pdfPage: 19,
    he: {
      title: 'לשכת הליכוד',
      summary: 'כ-91 חברים — חברי סיעת הכנסת, ראשי סניפים ונבחרים. מתכנסת תוך 90 יום מהוועידה; ההנהלה מסדירה ענייני יום-יום.',
      bullets: [
        'כינוס: מתכנסת תוך 90 יום מהוועידה',
        'הרכב: חברי סיעת הכנסת, ראשי רשויות מקומיות, ראשי סניפים, נבחרים וחברים מכוח כהונה',
        'ההנהלה: מטפלת בענייני יום-יום, כפופה ללשכה',
        'מועצה מייעצת: הלשכה רשאית להקים מועצה כלכלית-חברתית מייעצת',
        'בחירות: נערכות ע״י ועדת הבחירות המרכזית',
      ],
    },
    en: {
      title: 'The Likud Bureau',
      summary: 'About 91 members — Knesset faction members, branch heads and elected officials. Convenes within 90 days of the convention; the management handles day-to-day matters.',
      bullets: [
        'Convening: meets within 90 days of the convention',
        'Composition: Knesset faction members, heads of local authorities, branch heads, elected officials and ex-officio members',
        'Management: handles day-to-day matters, subordinate to the Bureau',
        'Advisory council: the Bureau may establish an advisory economic-social council',
        'Elections: conducted by the central elections committee',
      ],
    },
  },
  {
    key: 'secretariat', color: 'teal', pdfPage: 21,
    he: {
      title: 'מזכירות הליכוד',
      summary: 'גוף מנהלי — ניהול רשומות, תיאום פעולות ההנהלה וביצוע החלטות. מנהלת את הפעילות השוטפת של הסניפים.',
      bullets: [
        'בחירה: נבחרת ע״י הוועידה בבחירות אישיות',
        'ניהול רשומות: מנהלת את המסמכים והפרוטוקולים של התנועה',
        'תיאום: מתאמת פעולות ההנהלה ומפקחת על ביצוע החלטות',
        'סניפים: בוחנת פעילות סניפים ומנטרת יישום',
        'דיווח: מקבלת דו״חות מכל גופי התנועה; המזכיר משמש כמזכיר הלשכה',
      ],
    },
    en: {
      title: 'The Likud Secretariat',
      summary: 'An administrative body — records management, coordinating the management’s actions and implementing decisions. Manages the ongoing activity of the branches.',
      bullets: [
        'Election: elected by the convention in personal elections',
        'Records: manages the movement’s documents and protocols',
        'Coordination: coordinates the management’s actions and oversees implementation of decisions',
        'Branches: reviews branch activity and monitors implementation',
        'Reporting: receives reports from all movement bodies; the secretary serves as the Bureau’s secretary',
      ],
    },
  },
  {
    key: 'oversight', color: 'red', pdfPage: 17,
    he: {
      title: 'ועדת הפיקוח',
      summary: 'מפקחת על בחירות יושב ראש, קובעת כללים, שומעת ערעורים ומוסמכת לפסול מועמדים. בראשות שופט בדימוס.',
      bullets: [
        'מינוי: ממונה ע״י המרכז, בראשות שופט בדימוס של ביהמ״ש העליון או המחוזי',
        'הרכב: עד 7 חברים, המרכז רשאי למנות 2 חברים חלופיים',
        'סמכויות: מפקחת על בחירות יו״ר — קובעת כללים, שומעת ערעורים, מוסמכת לפסול מועמדים',
        'הכרעות: ברוב קולות, עם קול מכריע לשופט היושב ראש',
        'סמכות סופית: החלטותיה אינן ניתנות לערעור בערכאות רגילות (למעט בג״ץ)',
      ],
    },
    en: {
      title: 'The Oversight Committee',
      summary: 'Supervises the chairman elections, sets rules, hears appeals and is authorized to disqualify candidates. Chaired by a retired judge.',
      bullets: [
        'Appointment: appointed by the Center, chaired by a retired Supreme or District Court judge',
        'Composition: up to 7 members; the Center may appoint 2 alternate members',
        'Powers: supervises the chairman elections — sets rules, hears appeals, may disqualify candidates',
        'Decisions: by majority vote, with a casting vote for the presiding judge',
        'Finality: its decisions are not appealable in the ordinary courts (except the High Court of Justice)',
      ],
    },
  },
  {
    key: 'court', color: 'purple', pdfPage: 22,
    he: {
      title: 'בית הדין',
      summary: 'עד 15 שופטים, נשיא שופט בדימוס. סמכויות: הפסקת חברות, נזיפה, השעיה, קנס והוצאה מהתנועה. פסיקה סופית — ללא ערעור לביהמ״ש.',
      bullets: [
        'הרכב: עד 15 שופטים, נבחרים ע״י הוועידה בבחירות אישיות',
        'נשיא: שופט בדימוס של ביהמ״ש העליון או המחוזי',
        'סנקציות: אזהרה, נזיפה, השעיה, הדחה, קנס, הוצאה מהתנועה',
        'סמכות שיפוט: סכסוכים פנימיים, הפסקת חברות, עניינים משמעתיים',
        'סופיות: פסיקות סופיות — אין ערעור לבתי משפט אזרחיים',
        'הוצאות: רשאי לפסוק הוצאות; פועל כבורר מוסמך',
      ],
    },
    en: {
      title: 'The Tribunal',
      summary: 'Up to 15 judges, presided over by a retired judge. Powers: termination of membership, reprimand, suspension, fine and expulsion. Final rulings — no appeal to the courts.',
      bullets: [
        'Composition: up to 15 judges, elected by the convention in personal elections',
        'President: a retired Supreme or District Court judge',
        'Sanctions: warning, reprimand, suspension, removal, fine, expulsion from the movement',
        'Jurisdiction: internal disputes, termination of membership, disciplinary matters',
        'Finality: rulings are final — no appeal to civil courts',
        'Costs: may award costs; acts as an authorized arbitrator',
      ],
    },
  },
  {
    key: 'auditor', color: 'green', pdfPage: 24,
    he: {
      title: 'המבקר הפנימי',
      summary: 'נבחר ע״י הוועידה, שופט בדימוס. ביקורת פיננסית, תפקודית וסניפית. מגיש דו״ח שנתי ליו״ר ולמזכירות.',
      bullets: [
        'מינוי: נבחר ע״י הוועידה, שופט בדימוס, אינו רשאי לכהן בתפקיד אחר בתנועה',
        'ביקורת: ביקורת פיננסית ותפעולית של כל הגופים והסניפים',
        'שיטות עבודה: קובע בעצמו את דרכי הביקורת, מגיש דו״ח שנתי ליו״ר ולמזכירות',
        'עוזרים: רשאי למנות יועצים ועוזרים',
        'ערעור: ניתן לערער על ממצאיו לבית הדין תוך 30 ימים',
        'משקיף: משתתף כמשקיף בישיבות המרכז, הלשכה והמזכירות',
      ],
    },
    en: {
      title: 'The Internal Auditor',
      summary: 'Elected by the convention; a retired judge. Conducts financial, functional and branch audits. Submits an annual report to the chairman and the secretariat.',
      bullets: [
        'Appointment: elected by the convention, a retired judge, may not hold another position in the movement',
        'Audit: financial and operational audit of all bodies and branches',
        'Methods: determines the audit methods independently, submits an annual report to the chairman and secretariat',
        'Assistants: may appoint advisors and assistants',
        'Appeal: findings may be appealed to the Tribunal within 30 days',
        'Observer: participates as an observer in the Center, Bureau and Secretariat meetings',
      ],
    },
  },
  {
    key: 'branches', color: 'orange', pdfPage: 7,
    he: {
      title: 'סניפים',
      summary: 'היחידה הארגונית המקומית — לפחות 300 חברים ברשות מקומית. כולל מועצת סניף, הנהלה, מזכירות וועדת בחירות.',
      bullets: [
        'מינימום: 300 חברים ברשות מקומית; תחום גיאוגרפי לפי הרשות',
        'מועצת סניף: 21-151 חברים — המוסד העליון של הסניף',
        'הנהלת סניף: עד ⅓ מחברי המועצה, מקסימום 51 חברים',
        'מזכירות סניף: עד ⅓ מחברי ההנהלה, מטפלת בענייני יום-יום',
        'ועדת בחירות: 5 חברים, מנהלת בחירות מקומיות',
        'דמי חבר: גבייה שנתית, 10% מהכנסות מועברים לתנועה',
      ],
    },
    en: {
      title: 'Branches',
      summary: 'The local organizational unit — at least 300 members in a local authority. Includes a branch council, management, secretariat and elections committee.',
      bullets: [
        'Minimum: 300 members in a local authority; geographic scope by the authority',
        'Branch council: 21-151 members — the branch’s supreme body',
        'Branch management: up to ⅓ of council members, maximum 51 members',
        'Branch secretariat: up to ⅓ of management members, handles day-to-day matters',
        'Elections committee: 5 members, runs local elections',
        'Dues: annual collection, 10% of revenue transferred to the movement',
      ],
    },
  },
  {
    key: 'youth', color: 'teal', pdfPage: 26,
    he: {
      title: 'צעירי הליכוד',
      summary: 'חברים עד גיל 35. בעלי ועידה, מועצה ארצית, ועד מנהל ויו״ר עצמאיים.',
      bullets: [
        'גיל: חברי תנועה עד גיל 35',
        'מוסדות: ועידה, מועצה ארצית, ועד מנהל (20 חברים), יו״ר',
        'ייצוג במועצה: הוועידה בוחרת 20% מהמועצה הארצית בהצבעה חשאית',
        'בחירת יו״ר: נבחר ישירות, שיטה דו-סיבובית (סף 40%)',
        'ייצוג: נציגות בכל גופי התנועה; חברי סיעת הכנסת נכללים',
      ],
    },
    en: {
      title: 'Likud Youth',
      summary: 'Members up to age 35. Have their own convention, national council, executive committee and chairman.',
      bullets: [
        'Age: movement members up to age 35',
        'Institutions: convention, national council, executive committee (20 members), chairman',
        'Council representation: the convention elects 20% of the national council by secret ballot',
        'Chairman election: elected directly, two-round system (40% threshold)',
        'Representation: presence in all movement bodies; Knesset faction members are included',
      ],
    },
  },
  {
    key: 'knesset', color: 'navy', pdfPage: 25,
    he: {
      title: 'סיעת הכנסת',
      summary: 'חברי הכנסת וחברי הממשלה מטעם התנועה. בוחרת יו״ר סיעה וועדות.',
      bullets: [
        'הרכב: חברי הכנסת והשרים מטעם התנועה',
        'בחירות פנימיות: בוחרת יו״ר סיעה, מועמדים לסגן יו״ר הכנסת, יושבי ראש ועדות',
        'מועמד לרה״מ: ממליצה על מועמד ע״פ יו״ר התנועה',
        'פריימריז: בחירות ישירות, אישיות, שוות וחשאיות לרשימה לכנסת',
        'פיקוח: ועדות מרכזית ופיקוח מנהלות את הפריימריז',
      ],
    },
    en: {
      title: 'The Knesset Faction',
      summary: 'The Knesset members and ministers on behalf of the movement. Elects a faction chair and committees.',
      bullets: [
        'Composition: the Knesset members and ministers on behalf of the movement',
        'Internal elections: elects a faction chair, candidates for Deputy Speaker, committee chairs',
        'PM candidate: recommends a candidate per the movement chairman',
        'Primaries: direct, personal, equal and secret elections for the Knesset list',
        'Oversight: central and oversight committees run the primaries',
      ],
    },
  },
  {
    key: 'histadrut', color: 'red', pdfPage: 25,
    he: {
      title: 'סיעת הליכוד בהסתדרות',
      summary: 'סיעת הליכוד בהסתדרות הכללית. פועלת במסגרת הכנסת הגדולה והוועידות.',
      bullets: [
        'מהות: סיעת הליכוד בהסתדרות הכללית של העובדים בישראל',
        'פעילות: פועלת במסגרת מוסדות ההסתדרות — הכנסת הגדולה, הוועידות והוועדים',
        'מטרה: ייצוג עמדות התנועה בהסתדרות וקידום זכויות העובדים',
      ],
    },
    en: {
      title: 'The Likud Faction in the Histadrut',
      summary: 'The Likud faction in the General Histadrut (labor federation). Operates within the Great Assembly and the conventions.',
      bullets: [
        'Nature: the Likud faction in the General Federation of Labor in Israel',
        'Activity: operates within the Histadrut institutions — the Great Assembly, conventions and committees',
        'Goal: representing the movement’s positions in the Histadrut and advancing workers’ rights',
      ],
    },
  },
  {
    key: 'world', color: 'green', pdfPage: 29,
    he: {
      title: 'הליכוד העולמי',
      summary: 'תנועה ציונית עולמית. סניף ישראל שולח צירים לקונגרס הציוני ולמוסדות ההסתדרות הציונית.',
      bullets: [
        'מהות: תנועה ציונית עולמית, מאחדת סניפים בישראל ובתפוצות',
        'ייצוג: סניף ישראל שולח צירים לקונגרס הציוני ולמוסדות ההסתדרות הציונית',
        'חוקה: פועל לפי חוקת הליכוד העולמי; התנועה רשאית להוציא הנחיות',
        'כשירות: רק מי שעומד בכל תנאי הכשירות רשאי להיבחר כציר',
      ],
    },
    en: {
      title: 'World Likud',
      summary: 'A world Zionist movement. The Israel branch sends delegates to the Zionist Congress and the Zionist Organization institutions.',
      bullets: [
        'Nature: a world Zionist movement uniting branches in Israel and the diaspora',
        'Representation: the Israel branch sends delegates to the Zionist Congress and the Zionist Organization institutions',
        'Charter: operates under the World Likud charter; the movement may issue directives',
        'Eligibility: only those who meet all eligibility conditions may be elected as delegates',
      ],
    },
  },
  {
    key: 'local_gov', color: 'gold', pdfPage: 28,
    he: {
      title: 'השלטון המקומי',
      summary: 'סיעות הליכוד ברשויות המקומיות. בחירת מועמדים למועצות ולראשות הרשות.',
      bullets: [
        'סיעות: סיעות הליכוד במועצות הרשויות המקומיות',
        'פריימריז: בחירות ישירות למועמדים למועצות מקומיות',
        'ועדת היגוי: ממונה ע״י יו״ר התנועה באישור המרכז',
        'ראש רשות: מועמדים לראשות עיר נבחרים ע״י חברי הסניף',
      ],
    },
    en: {
      title: 'Local Government',
      summary: 'Likud factions in the local authorities. Selecting candidates for councils and for the head of the authority.',
      bullets: [
        'Factions: Likud factions in the local-authority councils',
        'Primaries: direct elections for local-council candidates',
        'Steering committee: appointed by the movement chairman with the Center’s approval',
        'Authority head: candidates for mayor are elected by the branch members',
      ],
    },
  },
]
