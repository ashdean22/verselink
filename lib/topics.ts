/**
 * lib/topics.ts — 50 high-intent Bible topic definitions
 *
 * Each topic becomes a static page at /topics/[slug].
 * AEO (Answer Engine Optimization): these pages are designed to show up
 * when people ask Bible questions in ChatGPT, Perplexity, Google, etc.
 * The slug is the URL, the question is what we run through the RAG pipeline.
 */

export interface Topic {
  title: string
  question: string
  related: string[]   // slugs of related topics — used for internal linking
}

export const TOPICS: Record<string, Topic> = {
  'anxiety':       { title: 'Anxiety & Worry',        question: 'What does Scripture say about anxiety and worry?',                related: ['fear', 'peace', 'trust'] },
  'grief':         { title: 'Grief & Loss',            question: 'How does the Bible address grief and loss?',                     related: ['comfort', 'suffering', 'hope'] },
  'forgiveness':   { title: 'Forgiveness',             question: 'What does the Bible say about forgiving others?',                related: ['conflict', 'repentance', 'grace'] },
  'strength':      { title: 'Strength & Weakness',     question: 'How do I find strength when I am weak and exhausted?',          related: ['suffering', 'faith', 'hope'] },
  'faith':         { title: 'Faith',                   question: 'What does Scripture teach about faith?',                        related: ['trust', 'doubt', 'prayer'] },
  'prayer':        { title: 'Prayer',                  question: 'How should a Christian pray?',                                  related: ['guidance', 'faith', 'peace'] },
  'love':          { title: 'Love',                    question: 'What does the Bible say about love?',                           related: ['god-love', 'marriage', 'enemies'] },
  'temptation':    { title: 'Temptation & Sin',        question: 'How do I resist temptation?',                                   related: ['sin', 'addiction', 'strength'] },
  'hope':          { title: 'Hope',                    question: 'What does Scripture say about hope?',                           related: ['suffering', 'faith', 'eternal-life'] },
  'money':         { title: 'Money & Wealth',          question: 'What does the Bible say about money and wealth?',               related: ['generosity', 'work', 'gratitude'] },
  'humility':      { title: 'Pride & Humility',        question: 'What does Scripture say about pride and humility?',             related: ['grace', 'obedience', 'wisdom'] },
  'guidance':      { title: "God's Guidance",          question: "How can I know and follow God's will for my life?",             related: ['prayer', 'wisdom', 'trust'] },
  'suffering':     { title: 'Suffering & Trials',      question: 'What does Scripture say about suffering and trials?',           related: ['hope', 'strength', 'comfort'] },
  'enemies':       { title: 'Loving Your Enemies',     question: 'How should I treat my enemies?',                               related: ['forgiveness', 'love', 'conflict'] },
  'peace':         { title: 'Peace',                   question: 'What does the Bible say about peace?',                         related: ['anxiety', 'conflict', 'prayer'] },
  'wisdom':        { title: 'Wisdom',                  question: 'How do I gain wisdom?',                                        related: ['guidance', 'humility', 'obedience'] },
  'generosity':    { title: 'Generosity & Giving',     question: 'What does Scripture say about generosity and giving?',          related: ['money', 'love', 'gratitude'] },
  'waiting':       { title: 'Waiting on God',          question: 'What does the Bible say about waiting and patience?',           related: ['trust', 'hope', 'guidance'] },
  'doubt':         { title: 'Doubt & Unbelief',        question: 'How do I deal with doubt and unbelief?',                       related: ['faith', 'trust', 'prayer'] },
  'anger':         { title: 'Anger',                   question: 'What does Scripture say about anger?',                         related: ['conflict', 'forgiveness', 'peace'] },
  'eternal-life':  { title: 'Eternal Life',            question: 'What does the Bible say about death and eternal life?',         related: ['salvation', 'resurrection', 'hope'] },
  'repentance':    { title: 'Confession & Repentance', question: 'What does the Bible say about confession and repentance?',      related: ['sin', 'grace', 'forgiveness'] },
  'fear':          { title: 'Fear',                    question: 'What does Scripture say about fear?',                          related: ['anxiety', 'trust', 'faith'] },
  'joy':           { title: 'Joy',                     question: 'What does the Bible say about joy?',                           related: ['worship', 'gratitude', 'hope'] },
  'marriage':      { title: 'Marriage',                question: 'What does Scripture say about marriage?',                      related: ['love', 'conflict', 'parenting'] },
  'comfort':       { title: 'Comfort',                 question: 'How does God comfort those who are hurting?',                  related: ['grief', 'suffering', 'god-love'] },
  'purpose':       { title: 'Purpose & Calling',       question: 'What does the Bible say about finding your purpose?',          related: ['guidance', 'work', 'identity'] },
  'loneliness':    { title: 'Loneliness',              question: 'What does Scripture say about loneliness and isolation?',      related: ['comfort', 'grief', 'god-love'] },
  'identity':      { title: 'Identity in Christ',      question: 'What does the Bible say about our identity in Christ?',        related: ['salvation', 'grace', 'purpose'] },
  'grace':         { title: 'Grace',                   question: 'What does Scripture say about the grace of God?',              related: ['salvation', 'forgiveness', 'shame'] },
  'salvation':     { title: 'Salvation',               question: 'What does the Bible say about salvation?',                     related: ['grace', 'eternal-life', 'repentance'] },
  'sin':           { title: 'Sin',                     question: 'What does Scripture say about sin?',                           related: ['repentance', 'temptation', 'grace'] },
  'shame':         { title: 'Shame & Guilt',           question: 'How does the Bible address shame and guilt?',                  related: ['grace', 'repentance', 'identity'] },
  'healing':       { title: 'Healing',                 question: 'What does Scripture say about healing?',                      related: ['suffering', 'faith', 'hope'] },
  'depression':    { title: 'Depression & Despair',    question: 'What does the Bible say about depression and despair?',        related: ['grief', 'hope', 'comfort'] },
  'rejection':     { title: 'Rejection',               question: 'What does Scripture say about rejection and feeling unwanted?', related: ['loneliness', 'identity', 'god-love'] },
  'betrayal':      { title: 'Betrayal',                question: 'What does the Bible say about betrayal and broken trust?',     related: ['forgiveness', 'grief', 'trust'] },
  'addiction':     { title: 'Addiction & Freedom',     question: 'What does Scripture say about addiction and freedom?',         related: ['temptation', 'strength', 'grace'] },
  'death':         { title: 'Death & Heaven',          question: 'What does the Bible say about death and heaven?',              related: ['eternal-life', 'resurrection', 'grief'] },
  'parenting':     { title: 'Parenting',               question: 'What does Scripture say about raising children?',              related: ['wisdom', 'love', 'marriage'] },
  'work':          { title: 'Work & Vocation',         question: 'What does the Bible say about work and vocation?',             related: ['purpose', 'money', 'gratitude'] },
  'gratitude':     { title: 'Gratitude',               question: 'What does Scripture say about gratitude and thankfulness?',   related: ['joy', 'generosity', 'worship'] },
  'obedience':     { title: 'Obedience to God',        question: 'What does the Bible say about obedience to God?',             related: ['faith', 'humility', 'guidance'] },
  'worship':       { title: 'Worship',                 question: 'What does Scripture say about worship?',                      related: ['joy', 'gratitude', 'prayer'] },
  'baptism':       { title: 'Baptism',                 question: 'What does the Bible say about baptism?',                      related: ['salvation', 'repentance', 'holy-spirit'] },
  'resurrection':  { title: 'Resurrection',            question: 'What does Scripture say about the resurrection?',             related: ['eternal-life', 'death', 'hope'] },
  'holy-spirit':   { title: 'Holy Spirit',             question: 'What does the Bible say about the Holy Spirit?',              related: ['prayer', 'guidance', 'baptism'] },
  'trust':         { title: 'Trusting God',            question: 'What does the Bible say about trusting God?',                 related: ['faith', 'guidance', 'waiting'] },
  'god-love':      { title: "God's Love",              question: "How does Scripture describe God's love for us?",              related: ['grace', 'salvation', 'comfort'] },
  'conflict':      { title: 'Conflict Resolution',     question: 'How do I resolve conflict with other people?',                related: ['forgiveness', 'peace', 'enemies'] },
}

export const TOPIC_SLUGS = Object.keys(TOPICS)
