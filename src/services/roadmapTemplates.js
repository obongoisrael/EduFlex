/**
 * Smart Learning Roadmap — hybrid generation (templates + custom fallback).
 *
 * 1. If the course/unit name matches a predefined template (Database Systems,
 *    Web Development, Programming Fundamentals, Software Engineering,
 *    Data Structures, Networking, Research Methods, Cybersecurity) → use it.
 * 2. Otherwise generate a flexible custom structure from the course name,
 *    goal, level, duration and learning style.
 *
 * Output shape (consumed by the preview/save endpoints):
 * { source, tools: [{name,purpose,category,is_required}],
 *   stages: [{ title, description, topics: [{ title, description, hours,
 *     tasks: [{ title, task_type, estimated_minutes }] }] }] }
 */

/** Compact template definitions. hours are base values, later scaled to duration. */
const TEMPLATES = [
  {
    match: ['database', 'dbms', 'sql'],
    tools: [
      { name: 'MySQL or PostgreSQL', purpose: 'Practice SQL queries hands-on', category: 'Database', is_required: 1 },
      { name: 'draw.io / dbdiagram.io', purpose: 'Draw ER diagrams', category: 'Design', is_required: 0 },
    ],
    stages: [
      ['Foundations of Databases', [
        ['Introduction to databases and DBMS', 2, [['Compare file systems vs DBMS in your own words', 'Checkpoint', 20]]],
        ['The relational model, tables and keys', 3, [['Identify primary/foreign keys in 3 sample schemas', 'Practice', 30]]],
        ['ER modelling and diagrams', 3, [['Draw an ER diagram for a school library system', 'Mini-project', 60]]],
      ]],
      ['SQL Mastery', [
        ['SELECT, WHERE, ORDER BY basics', 3, [['Solve 10 basic SELECT exercises', 'Practice', 45]]],
        ['JOINs, GROUP BY and aggregate functions', 4, [['Write 8 queries joining 2–3 tables', 'Practice', 60]]],
        ['Subqueries, views and indexes', 3, [['Rewrite 3 JOIN queries as subqueries', 'Practice', 40]]],
      ]],
      ['Design & Advanced Topics', [
        ['Normalization (1NF–3NF)', 3, [['Normalize an unnormalized invoice table to 3NF', 'Practice', 45], ['Explain anomalies solved by each normal form', 'Checkpoint', 20]]],
        ['Transactions and ACID properties', 2, [['Describe a real scenario for each ACID property', 'Checkpoint', 25]]],
        ['Build a mini database project', 4, [['Design + implement a database for a small business', 'Mini-project', 120]]],
      ]],
    ],
  },
  {
    match: ['web', 'html', 'frontend', 'website'],
    tools: [
      { name: 'VS Code', purpose: 'Write HTML/CSS/JS', category: 'Editor', is_required: 1 },
      { name: 'Chrome DevTools', purpose: 'Debug and inspect pages', category: 'Debugging', is_required: 1 },
    ],
    stages: [
      ['Web Foundations', [
        ['How the web works: HTTP, browsers, servers', 2, [['Trace what happens when you visit a URL', 'Checkpoint', 20]]],
        ['HTML structure and semantic tags', 3, [['Build a personal profile page in pure HTML', 'Practice', 60]]],
        ['CSS selectors, box model and layout', 4, [['Style your profile page with flexbox', 'Practice', 60]]],
      ]],
      ['Interactive Front-end', [
        ['JavaScript basics: variables, functions, DOM', 4, [['Add a dark-mode toggle to your page', 'Practice', 45]]],
        ['Events, forms and validation', 3, [['Build a signup form with live validation', 'Practice', 60]]],
        ['Responsive design and media queries', 3, [['Make your pages mobile-friendly', 'Practice', 45]]],
      ]],
      ['Capstone', [
        ['Fetch API and dynamic data', 3, [['Display live data from a public API', 'Practice', 60]]],
        ['Build and deploy a complete website', 5, [['Create a 3-page site and host it free (GitHub Pages/Netlify)', 'Mini-project', 180]]],
      ]],
    ],
  },
  {
    match: ['programming', 'python', 'coding', 'c++', 'java fundamentals', 'introduction to computer'],
    tools: [
      { name: 'Python (or course language) + IDE', purpose: 'Write and run programs', category: 'Language', is_required: 1 },
    ],
    stages: [
      ['Getting Started', [
        ['Variables, data types and operators', 3, [['Write a unit converter program', 'Practice', 40]]],
        ['Input, output and string handling', 2, [['Build a mad-libs word game', 'Practice', 30]]],
        ['Conditionals and boolean logic', 3, [['Write a grade-classification program', 'Practice', 40]]],
      ]],
      ['Control & Structure', [
        ['Loops (for, while) and iteration patterns', 3, [['Solve 8 loop exercises (patterns, sums, searches)', 'Practice', 60]]],
        ['Functions, parameters and return values', 3, [['Refactor earlier programs into functions', 'Practice', 45]]],
        ['Lists/arrays and dictionaries', 4, [['Build a student marks manager (add/search/average)', 'Practice', 60]]],
      ]],
      ['Applied Programming', [
        ['File handling and error handling', 3, [['Save/load the marks manager data to a file', 'Practice', 45]]],
        ['Final console project', 4, [['Build a small quiz or inventory app', 'Mini-project', 150], ['Explain your code line-by-line to a friend', 'Checkpoint', 30]]],
      ]],
    ],
  },
  {
    match: ['software engineering', 'sdlc', 'agile'],
    tools: [
      { name: 'Git + GitHub', purpose: 'Version control and collaboration', category: 'VCS', is_required: 1 },
      { name: 'Trello / GitHub Projects', purpose: 'Task and sprint tracking', category: 'PM', is_required: 0 },
    ],
    stages: [
      ['SE Fundamentals', [
        ['SDLC models: waterfall, agile, spiral', 3, [['Compare 3 SDLC models with pros/cons', 'Checkpoint', 30]]],
        ['Requirements engineering', 3, [['Write functional + non-functional requirements for an app idea', 'Practice', 45]]],
        ['UML: use case and class diagrams', 3, [['Draw use-case + class diagrams for your app', 'Practice', 60]]],
      ]],
      ['Building Software Properly', [
        ['Software design principles and architecture', 3, [['Sketch a 3-tier architecture for your app', 'Practice', 40]]],
        ['Version control workflows with Git', 2, [['Create a repo, branch, merge and resolve a conflict', 'Practice', 45]]],
        ['Testing: unit, integration, acceptance', 3, [['Write test cases for one module of your app', 'Practice', 45]]],
      ]],
      ['Delivery', [
        ['Agile in practice: scrum, sprints, standups', 2, [['Plan a 1-week sprint backlog for your project', 'Practice', 30]]],
        ['Mini software project with documentation', 4, [['Deliver a small documented project (SRS + code + tests)', 'Mini-project', 180]]],
      ]],
    ],
  },
  {
    match: ['data structure', 'algorithms', 'dsa'],
    tools: [{ name: 'Any language + visualgo.net', purpose: 'Implement & visualize structures', category: 'Practice', is_required: 1 }],
    stages: [
      ['Linear Structures', [
        ['Arrays, complexity and Big-O basics', 3, [['Analyse complexity of 5 code snippets', 'Practice', 40]]],
        ['Linked lists (single, double)', 3, [['Implement a linked list with insert/delete', 'Practice', 60]]],
        ['Stacks and queues', 3, [['Build a bracket-matching checker with a stack', 'Practice', 45]]],
      ]],
      ['Non-linear Structures', [
        ['Trees and binary search trees', 4, [['Implement BST insert/search/traversals', 'Practice', 60]]],
        ['Heaps and priority queues', 2, [['Trace heapify on paper for 2 arrays', 'Checkpoint', 30]]],
        ['Graphs: representation, BFS, DFS', 4, [['Implement BFS/DFS on an adjacency list', 'Practice', 60]]],
      ]],
      ['Algorithms', [
        ['Sorting: bubble, insertion, merge, quick', 4, [['Implement merge sort + quick sort, compare timings', 'Practice', 60]]],
        ['Searching and hashing', 2, [['Implement binary search + a simple hash table', 'Practice', 45]]],
        ['Mixed problem-solving session', 3, [['Solve 5 past-paper DSA questions under time', 'Checkpoint', 90]]],
      ]],
    ],
  },
  {
    match: ['network', 'ccna', 'tcp'],
    tools: [{ name: 'Cisco Packet Tracer', purpose: 'Simulate networks', category: 'Simulation', is_required: 1 }],
    stages: [
      ['Networking Basics', [
        ['Network types, topologies and devices', 3, [['Match 10 devices to their OSI layer', 'Practice', 30]]],
        ['The OSI and TCP/IP models', 3, [['Explain each OSI layer with a real protocol', 'Checkpoint', 30]]],
        ['IP addressing and subnetting', 4, [['Solve 10 subnetting exercises', 'Practice', 60]]],
      ]],
      ['Protocols & Routing', [
        ['Switching, VLANs and ARP', 3, [['Configure 2 VLANs in Packet Tracer', 'Practice', 45]]],
        ['Routing basics and protocols (RIP, OSPF)', 3, [['Set up routing between two networks', 'Practice', 60]]],
        ['TCP vs UDP, ports and common services', 2, [['List 10 services with their ports/protocols', 'Practice', 25]]],
      ]],
      ['Applied Networking', [
        ['DNS, DHCP and NAT', 3, [['Configure DHCP + NAT in a simulated LAN', 'Practice', 45]]],
        ['Design a small campus network', 4, [['Build a 2-building network in Packet Tracer', 'Mini-project', 120]]],
      ]],
    ],
  },
  {
    match: ['research', 'thesis', 'proposal', 'methodology'],
    tools: [
      { name: 'Zotero / Mendeley', purpose: 'Manage references and citations', category: 'References', is_required: 1 },
      { name: 'Google Scholar', purpose: 'Find academic literature', category: 'Search', is_required: 1 },
    ],
    stages: [
      ['Research Foundations', [
        ['Types of research and research design', 3, [['Classify 5 published papers by research type', 'Practice', 40]]],
        ['Formulating problems, questions & objectives', 3, [['Draft your research problem + 3 objectives', 'Practice', 60]]],
        ['Literature review techniques', 4, [['Summarize 5 relevant papers in a review matrix', 'Practice', 90]]],
      ]],
      ['Methodology & Data', [
        ['Sampling, population and data collection tools', 3, [['Design a questionnaire or interview guide', 'Practice', 60]]],
        ['Quantitative vs qualitative analysis', 3, [['Choose and justify an analysis method for your study', 'Checkpoint', 30]]],
        ['Validity, reliability and ethics', 2, [['Write the ethics section for your proposal', 'Practice', 40]]],
      ]],
      ['Producing the Document', [
        ['Citation styles and referencing', 2, [['Format 10 references in APA correctly', 'Practice', 30]]],
        ['Write and polish the full proposal', 5, [['Complete a full draft proposal', 'Mini-project', 240]]],
      ]],
    ],
  },
  {
    match: ['security', 'cyber', 'ethical hacking', 'infosec'],
    tools: [
      { name: 'TryHackMe / OverTheWire (legal labs)', purpose: 'Safe hands-on practice', category: 'Labs', is_required: 1 },
      { name: 'Wireshark', purpose: 'Analyse network traffic', category: 'Analysis', is_required: 0 },
    ],
    stages: [
      ['Security Foundations', [
        ['CIA triad, threats and vulnerabilities', 3, [['Map 5 real breaches to CIA violations', 'Practice', 40]]],
        ['Malware types and attack vectors', 3, [['Create a table of malware types + defenses', 'Practice', 30]]],
        ['Authentication, passwords and 2FA', 2, [['Audit your own accounts for weak auth', 'Practice', 30]]],
      ]],
      ['Defensive Techniques', [
        ['Cryptography basics: hashing & encryption', 3, [['Explain symmetric vs asymmetric with examples', 'Checkpoint', 30]]],
        ['Network security: firewalls, IDS, VPNs', 3, [['Design a secure small-office network on paper', 'Practice', 45]]],
        ['Web security: OWASP Top 10 overview', 3, [['Summarize each OWASP Top-10 risk + defense', 'Practice', 60]]],
      ]],
      ['Applied Security', [
        ['Security policies and risk assessment', 2, [['Draft a mini security policy for a school lab', 'Practice', 45]]],
        ['Guided lab practice (legal platforms)', 4, [['Complete 3 beginner rooms on a legal lab platform', 'Mini-project', 120]]],
      ]],
    ],
  },
];

/** Custom fallback generator: sensible structure for ANY subject. */
function customStructure(form) {
  const s = form.course_name.trim();
  const style = form.preferred_learning_style || 'Mixed';
  const level = form.current_level || 'Beginner';

  const stages = [];
  if (level !== 'Advanced') {
    stages.push(['Foundations', [
      [`Introduction and overview of ${s}`, 2, [[`List the 5 most important concepts in ${s}`, 'Checkpoint', 20]]],
      [`Key terminology and core principles of ${s}`, 3, [[`Create a glossary of 15 key ${s} terms`, 'Practice', 30]]],
    ]]);
  }
  stages.push(['Core Concepts', [
    [`Main theories and techniques in ${s}`, 4, [[`Summarize each major topic of ${s} in one paragraph`, 'Practice', 45]]],
    [`Worked examples and standard problems in ${s}`, 4, [[`Solve 5 standard problems or answer 5 review questions`, 'Practice', 60]]],
    [`Advanced ideas and common misconceptions`, 3, [[`Explain 3 tricky areas of ${s} to a classmate`, 'Checkpoint', 30]]],
  ]]);
  if (style === 'Project-based' || style === 'Practical' || style === 'Mixed') {
    stages.push(['Applied Practice', [
      [`Hands-on application of ${s}`, 4, [[`Complete a practical exercise applying ${s}`, 'Practice', 60]]],
      [`Mini-project: apply ${s} to a real scenario`, 4, [[`Plan and complete a small ${s} project`, 'Mini-project', 150]]],
    ]]);
  }
  if (style === 'Exam-focused' || style === 'Mixed' || style === 'Theory-based') {
    stages.push(['Revision & Self-Assessment', [
      [`Summary notes and concept mapping for ${s}`, 2, [[`Condense ${s} into a 2-page summary sheet`, 'Practice', 60]]],
      [`Past questions and timed practice`, 3, [[`Attempt a past paper or 10 practice questions under exam time`, 'Checkpoint', 90]]],
    ]]);
  }

  return {
    source: 'custom',
    tools: [{ name: 'Course notes & recommended textbook', purpose: `Primary study material for ${s}`, category: 'Materials', is_required: 1 }],
    stages,
  };
}

/** Expand compact [title, [topics]] arrays into full objects and scale hours to duration. */
function buildStructure(form) {
  const name = (form.course_name || '').toLowerCase();
  const tpl = TEMPLATES.find(t => t.match.some(m => name.includes(m)));
  const raw = tpl
    ? { source: 'template', tools: tpl.tools, stages: tpl.stages }
    : customStructure(form);

  // Scale topic hours so total fits the chosen duration (≈1h/day, clamped 8–60h)
  const rawTotal = raw.stages.reduce((s, [, topics]) =>
    s + topics.reduce((a, t) => a + t[1], 0), 0);
  const target = Math.min(60, Math.max(8, (Number(form.duration_days) || 14)));
  const factor = target / rawTotal;

  const stages = raw.stages.map(([title, topics], si) => ({
    title,
    description: '',
    stage_order: si,
    topics: topics.map((t, ti) => ({
      title: t[0],
      description: '',
      topic_order: ti,
      hours: Math.max(0.5, Math.round(t[1] * factor * 2) / 2),
      tasks: (t[2] || []).map(([tt, type, min]) => ({
        title: tt, task_type: type, estimated_minutes: min,
      })),
    })),
  }));

  return { source: raw.source, tools: raw.tools, stages };
}

module.exports = { buildStructure };
