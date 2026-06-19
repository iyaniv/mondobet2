"""
104 WC 2026 matches — group stage (s=1) + knockout rounds (s=2..6).
Team names in knockout rounds are slot labels; they will be filled in
by the admin once the preceding stage results are known.
"""

STAGES = [
    {"n": 1, "name": "Group Stage",    "first": 1,   "last": 72},
    {"n": 2, "name": "Round of 32",    "first": 73,  "last": 88},
    {"n": 3, "name": "Round of 16",    "first": 89,  "last": 96},
    {"n": 4, "name": "Quarterfinals",  "first": 97,  "last": 100},
    {"n": 5, "name": "Semi-finals",    "first": 101, "last": 102},
    {"n": 6, "name": "Final & 3rd",    "first": 103, "last": 104},
]

MATCHES = [
  # ── Group Stage (Stage 1) ──────────────────────────────────────────────────
  {"n":1, "s":1,"g":"A","t":"2026-06-11T19:00:00Z","a":"Mexico","b":"South Africa"},
  {"n":2, "s":1,"g":"A","t":"2026-06-12T02:00:00Z","a":"Korea Republic","b":"Czech Republic"},
  {"n":3, "s":1,"g":"B","t":"2026-06-12T19:00:00Z","a":"Canada","b":"Bosnia and Herzegovina"},
  {"n":4, "s":1,"g":"D","t":"2026-06-13T01:00:00Z","a":"United States","b":"Paraguay"},
  {"n":5, "s":1,"g":"C","t":"2026-06-14T01:00:00Z","a":"Haiti","b":"Scotland"},
  {"n":6, "s":1,"g":"D","t":"2026-06-14T04:00:00Z","a":"Australia","b":"Turkey"},
  {"n":7, "s":1,"g":"C","t":"2026-06-13T22:00:00Z","a":"Brazil","b":"Morocco"},
  {"n":8, "s":1,"g":"B","t":"2026-06-13T19:00:00Z","a":"Qatar","b":"Switzerland"},
  {"n":9, "s":1,"g":"E","t":"2026-06-14T23:00:00Z","a":"Ivory Coast","b":"Ecuador"},
  {"n":10,"s":1,"g":"E","t":"2026-06-14T17:00:00Z","a":"Germany","b":"Curaçao"},
  {"n":11,"s":1,"g":"F","t":"2026-06-14T20:00:00Z","a":"Netherlands","b":"Japan"},
  {"n":12,"s":1,"g":"F","t":"2026-06-15T02:00:00Z","a":"Sweden","b":"Tunisia"},
  {"n":13,"s":1,"g":"H","t":"2026-06-15T22:00:00Z","a":"Saudi Arabia","b":"Uruguay"},
  {"n":14,"s":1,"g":"H","t":"2026-06-15T16:00:00Z","a":"Spain","b":"Cape Verde"},
  {"n":15,"s":1,"g":"G","t":"2026-06-16T01:00:00Z","a":"Iran","b":"New Zealand"},
  {"n":16,"s":1,"g":"G","t":"2026-06-15T19:00:00Z","a":"Belgium","b":"Egypt"},
  {"n":17,"s":1,"g":"I","t":"2026-06-16T19:00:00Z","a":"France","b":"Senegal"},
  {"n":18,"s":1,"g":"I","t":"2026-06-16T22:00:00Z","a":"Iraq","b":"Norway"},
  {"n":19,"s":1,"g":"J","t":"2026-06-17T01:00:00Z","a":"Argentina","b":"Algeria"},
  {"n":20,"s":1,"g":"J","t":"2026-06-17T04:00:00Z","a":"Austria","b":"Jordan"},
  {"n":21,"s":1,"g":"L","t":"2026-06-17T23:00:00Z","a":"Ghana","b":"Panama"},
  {"n":22,"s":1,"g":"L","t":"2026-06-17T20:00:00Z","a":"England","b":"Croatia"},
  {"n":23,"s":1,"g":"K","t":"2026-06-17T17:00:00Z","a":"Portugal","b":"DR Congo"},
  {"n":24,"s":1,"g":"K","t":"2026-06-18T02:00:00Z","a":"Uzbekistan","b":"Colombia"},
  {"n":25,"s":1,"g":"A","t":"2026-06-18T16:00:00Z","a":"Czech Republic","b":"South Africa"},
  {"n":26,"s":1,"g":"B","t":"2026-06-18T19:00:00Z","a":"Switzerland","b":"Bosnia and Herzegovina"},
  {"n":27,"s":1,"g":"B","t":"2026-06-18T22:00:00Z","a":"Canada","b":"Qatar"},
  {"n":28,"s":1,"g":"A","t":"2026-06-19T01:00:00Z","a":"Mexico","b":"Korea Republic"},
  {"n":29,"s":1,"g":"C","t":"2026-06-20T00:30:00Z","a":"Brazil","b":"Haiti"},
  {"n":30,"s":1,"g":"C","t":"2026-06-19T22:00:00Z","a":"Scotland","b":"Morocco"},
  {"n":31,"s":1,"g":"D","t":"2026-06-19T19:00:00Z","a":"United States","b":"Australia"},
  {"n":32,"s":1,"g":"D","t":"2026-06-20T03:00:00Z","a":"Turkey","b":"Paraguay"},
  {"n":33,"s":1,"g":"E","t":"2026-06-20T20:00:00Z","a":"Germany","b":"Ivory Coast"},
  {"n":34,"s":1,"g":"E","t":"2026-06-21T00:00:00Z","a":"Ecuador","b":"Curaçao"},
  {"n":35,"s":1,"g":"F","t":"2026-06-20T17:00:00Z","a":"Netherlands","b":"Sweden"},
  {"n":36,"s":1,"g":"F","t":"2026-06-21T04:00:00Z","a":"Tunisia","b":"Japan"},
  {"n":37,"s":1,"g":"H","t":"2026-06-21T22:00:00Z","a":"Uruguay","b":"Cape Verde"},
  {"n":38,"s":1,"g":"H","t":"2026-06-21T16:00:00Z","a":"Spain","b":"Saudi Arabia"},
  {"n":39,"s":1,"g":"G","t":"2026-06-21T19:00:00Z","a":"Belgium","b":"Iran"},
  {"n":40,"s":1,"g":"G","t":"2026-06-22T01:00:00Z","a":"New Zealand","b":"Egypt"},
  {"n":41,"s":1,"g":"I","t":"2026-06-23T00:00:00Z","a":"Norway","b":"Senegal"},
  {"n":42,"s":1,"g":"I","t":"2026-06-22T20:00:00Z","a":"France","b":"Iraq"},
  {"n":43,"s":1,"g":"J","t":"2026-06-22T17:00:00Z","a":"Argentina","b":"Austria"},
  {"n":44,"s":1,"g":"J","t":"2026-06-23T03:00:00Z","a":"Jordan","b":"Algeria"},
  {"n":45,"s":1,"g":"L","t":"2026-06-23T20:00:00Z","a":"England","b":"Ghana"},
  {"n":46,"s":1,"g":"L","t":"2026-06-23T23:00:00Z","a":"Panama","b":"Croatia"},
  {"n":47,"s":1,"g":"K","t":"2026-06-23T17:00:00Z","a":"Portugal","b":"Uzbekistan"},
  {"n":48,"s":1,"g":"K","t":"2026-06-24T02:00:00Z","a":"Colombia","b":"DR Congo"},
  {"n":49,"s":1,"g":"C","t":"2026-06-24T22:00:00Z","a":"Scotland","b":"Brazil"},
  {"n":50,"s":1,"g":"C","t":"2026-06-24T22:00:00Z","a":"Morocco","b":"Haiti"},
  {"n":51,"s":1,"g":"B","t":"2026-06-24T19:00:00Z","a":"Switzerland","b":"Canada"},
  {"n":52,"s":1,"g":"B","t":"2026-06-24T19:00:00Z","a":"Bosnia and Herzegovina","b":"Qatar"},
  {"n":53,"s":1,"g":"A","t":"2026-06-25T01:00:00Z","a":"Czech Republic","b":"Mexico"},
  {"n":54,"s":1,"g":"A","t":"2026-06-25T01:00:00Z","a":"South Africa","b":"Korea Republic"},
  {"n":55,"s":1,"g":"E","t":"2026-06-25T20:00:00Z","a":"Curaçao","b":"Ivory Coast"},
  {"n":56,"s":1,"g":"E","t":"2026-06-25T20:00:00Z","a":"Ecuador","b":"Germany"},
  {"n":57,"s":1,"g":"F","t":"2026-06-25T23:00:00Z","a":"Japan","b":"Sweden"},
  {"n":58,"s":1,"g":"F","t":"2026-06-25T23:00:00Z","a":"Tunisia","b":"Netherlands"},
  {"n":59,"s":1,"g":"D","t":"2026-06-26T02:00:00Z","a":"Turkey","b":"United States"},
  {"n":60,"s":1,"g":"D","t":"2026-06-26T02:00:00Z","a":"Paraguay","b":"Australia"},
  {"n":61,"s":1,"g":"I","t":"2026-06-26T19:00:00Z","a":"Norway","b":"France"},
  {"n":62,"s":1,"g":"I","t":"2026-06-26T19:00:00Z","a":"Senegal","b":"Iraq"},
  {"n":63,"s":1,"g":"G","t":"2026-06-27T03:00:00Z","a":"Egypt","b":"Iran"},
  {"n":64,"s":1,"g":"G","t":"2026-06-27T03:00:00Z","a":"New Zealand","b":"Belgium"},
  {"n":65,"s":1,"g":"H","t":"2026-06-27T00:00:00Z","a":"Cape Verde","b":"Saudi Arabia"},
  {"n":66,"s":1,"g":"H","t":"2026-06-27T00:00:00Z","a":"Uruguay","b":"Spain"},
  {"n":67,"s":1,"g":"L","t":"2026-06-27T21:00:00Z","a":"Panama","b":"England"},
  {"n":68,"s":1,"g":"L","t":"2026-06-27T21:00:00Z","a":"Croatia","b":"Ghana"},
  {"n":69,"s":1,"g":"J","t":"2026-06-28T02:00:00Z","a":"Algeria","b":"Austria"},
  {"n":70,"s":1,"g":"J","t":"2026-06-28T02:00:00Z","a":"Jordan","b":"Argentina"},
  {"n":71,"s":1,"g":"K","t":"2026-06-27T23:30:00Z","a":"Colombia","b":"Portugal"},
  {"n":72,"s":1,"g":"K","t":"2026-06-27T23:30:00Z","a":"DR Congo","b":"Uzbekistan"},

  # ── Round of 32 (Stage 2) ─────────────────────────────────────────────────
  {"n":73, "s":2,"g":"R32","t":"2026-06-28T14:00:00Z","a":"1st A","b":"2nd B"},
  {"n":74, "s":2,"g":"R32","t":"2026-06-28T18:00:00Z","a":"1st B","b":"2nd A"},
  {"n":75, "s":2,"g":"R32","t":"2026-06-29T14:00:00Z","a":"1st C","b":"2nd D"},
  {"n":76, "s":2,"g":"R32","t":"2026-06-29T18:00:00Z","a":"1st D","b":"2nd C"},
  {"n":77, "s":2,"g":"R32","t":"2026-06-30T14:00:00Z","a":"1st E","b":"2nd F"},
  {"n":78, "s":2,"g":"R32","t":"2026-06-30T18:00:00Z","a":"1st F","b":"2nd E"},
  {"n":79, "s":2,"g":"R32","t":"2026-07-01T14:00:00Z","a":"1st G","b":"2nd H"},
  {"n":80, "s":2,"g":"R32","t":"2026-07-01T18:00:00Z","a":"1st H","b":"2nd G"},
  {"n":81, "s":2,"g":"R32","t":"2026-07-02T14:00:00Z","a":"1st I","b":"2nd J"},
  {"n":82, "s":2,"g":"R32","t":"2026-07-02T18:00:00Z","a":"1st J","b":"2nd I"},
  {"n":83, "s":2,"g":"R32","t":"2026-07-03T14:00:00Z","a":"1st K","b":"2nd L"},
  {"n":84, "s":2,"g":"R32","t":"2026-07-03T18:00:00Z","a":"1st L","b":"2nd K"},
  {"n":85, "s":2,"g":"R32","t":"2026-07-04T12:00:00Z","a":"Best 3rd (1)","b":"Best 3rd (2)"},
  {"n":86, "s":2,"g":"R32","t":"2026-07-04T15:00:00Z","a":"Best 3rd (3)","b":"Best 3rd (4)"},
  {"n":87, "s":2,"g":"R32","t":"2026-07-04T18:00:00Z","a":"Best 3rd (5)","b":"Best 3rd (6)"},
  {"n":88, "s":2,"g":"R32","t":"2026-07-04T21:00:00Z","a":"Best 3rd (7)","b":"Best 3rd (8)"},

  # ── Round of 16 (Stage 3) ─────────────────────────────────────────────────
  {"n":89, "s":3,"g":"R16","t":"2026-07-05T14:00:00Z","a":"W M73","b":"W M74"},
  {"n":90, "s":3,"g":"R16","t":"2026-07-05T18:00:00Z","a":"W M75","b":"W M76"},
  {"n":91, "s":3,"g":"R16","t":"2026-07-06T14:00:00Z","a":"W M77","b":"W M78"},
  {"n":92, "s":3,"g":"R16","t":"2026-07-06T18:00:00Z","a":"W M79","b":"W M80"},
  {"n":93, "s":3,"g":"R16","t":"2026-07-07T14:00:00Z","a":"W M81","b":"W M82"},
  {"n":94, "s":3,"g":"R16","t":"2026-07-07T18:00:00Z","a":"W M83","b":"W M84"},
  {"n":95, "s":3,"g":"R16","t":"2026-07-08T14:00:00Z","a":"W M85","b":"W M86"},
  {"n":96, "s":3,"g":"R16","t":"2026-07-08T18:00:00Z","a":"W M87","b":"W M88"},

  # ── Quarterfinals (Stage 4) ───────────────────────────────────────────────
  {"n":97, "s":4,"g":"QF","t":"2026-07-09T18:00:00Z","a":"W M89","b":"W M90"},
  {"n":98, "s":4,"g":"QF","t":"2026-07-10T18:00:00Z","a":"W M91","b":"W M92"},
  {"n":99, "s":4,"g":"QF","t":"2026-07-11T18:00:00Z","a":"W M93","b":"W M94"},
  {"n":100,"s":4,"g":"QF","t":"2026-07-12T18:00:00Z","a":"W M95","b":"W M96"},

  # ── Semi-finals (Stage 5) ─────────────────────────────────────────────────
  {"n":101,"s":5,"g":"SF","t":"2026-07-14T18:00:00Z","a":"W M97","b":"W M98"},
  {"n":102,"s":5,"g":"SF","t":"2026-07-15T18:00:00Z","a":"W M99","b":"W M100"},

  # ── Final & 3rd Place (Stage 6) ───────────────────────────────────────────
  # Bracket labels are "FIN"/"3P", not "F" — Group F is a real group-stage
  # group letter, so using "F" here would collide and pull the Final into
  # Group F's standings.
  {"n":103,"s":6,"g":"3P", "t":"2026-07-18T17:00:00Z","a":"L M101","b":"L M102"},
  {"n":104,"s":6,"g":"FIN","t":"2026-07-19T19:00:00Z","a":"W M101","b":"W M102"},
]

# Only real country names (group stage) go into TEAMS — used for winner picker
TEAMS = sorted({t for m in MATCHES if m["s"] == 1 for t in (m["a"], m["b"])})
MATCH_INDEX = {m["n"]: m for m in MATCHES}
