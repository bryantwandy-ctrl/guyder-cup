import React, { useState, useMemo, useEffect } from "react";
import { supabase } from "./supabaseClient";

// ---------- Design tokens ----------
const COLORS = {
  fairway: "#1B4332",
  fairwayDark: "#0F2A1D",
  cream: "#F3EEE2",
  tan: "#C9A66B",
  flag: "#B5392E",
  ink: "#1C1C1A",
  line: "#D8D0BC",
};

const SERIF = "'Source Serif Pro', Georgia, 'Times New Roman', serif";
const MONO = "'IBM Plex Mono', 'Courier New', monospace";

const TOURNAMENT_ID = "guyder-cup-2026"; // bump this each year to keep scores separate
const POLL_MS = 5000;

const TEAM_BOOTH = "Booth";
const TEAM_FISH = "Fish";

// ---------- Roster ----------
const defaultPlayers = [
  { id: 1, name: "Booth", team: TEAM_BOOTH, index: 17.2 },
  { id: 2, name: "Clinton", team: TEAM_BOOTH, index: 4.6 },
  { id: 3, name: "Niemeyer", team: TEAM_BOOTH, index: 8.1 },
  { id: 4, name: "Rams", team: TEAM_BOOTH, index: 11.6 },
  { id: 5, name: "Rio", team: TEAM_BOOTH, index: 11.8 },
  { id: 6, name: "AB", team: TEAM_BOOTH, index: 17.8 },
  { id: 7, name: "Bobby", team: TEAM_BOOTH, index: 20.5 },
  { id: 8, name: "J4", team: TEAM_BOOTH, index: 9.6 },
  { id: 9, name: "Fish", team: TEAM_FISH, index: 3.2 },
  { id: 10, name: "Danny", team: TEAM_FISH, index: 7.5 },
  { id: 11, name: "Rames", team: TEAM_FISH, index: 8.6 },
  { id: 12, name: "Bearman", team: TEAM_FISH, index: 9.4 },
  { id: 13, name: "Littel", team: TEAM_FISH, index: 15.6 },
  { id: 14, name: "Larson", team: TEAM_FISH, index: 8.4 },
  { id: 15, name: "Doug", team: TEAM_FISH, index: 23.6 },
  { id: 16, name: "Meyer", team: TEAM_FISH, index: 20.8 },
];

const alternates = [{ id: 99, name: "Aaron Jackson (17th man)" }];

// ---------- Courses & tees ----------
const defaultCourses = {
  Highlands: {
    strokeIndex: [5, 1, 17, 13, 11, 9, 15, 7, 3, 16, 10, 2, 18, 8, 12, 6, 14, 4],
    tees: [
      { id: "h-i", name: "I", rating: 72.4, slope: 140, par: 71 },
      { id: "h-ii", name: "II", rating: 71.3, slope: 138, par: 71 },
      { id: "h-iii", name: "III", rating: 70.4, slope: 135, par: 71 },
    ],
  },
  Keep: {
    strokeIndex: [1, 13, 9, 11, 7, 17, 15, 5, 3, 6, 10, 18, 4, 8, 12, 2, 16, 14],
    tees: [
      { id: "k-blue", name: "Blue", rating: 73.1, slope: 140, par: 72 },
      { id: "k-bluewhite", name: "Blue/White", rating: 71.9, slope: 135, par: 72 },
      { id: "k-white", name: "White", rating: 70.6, slope: 132, par: 72 },
      { id: "k-whitegreen", name: "White/Green", rating: 68.3, slope: 130, par: 72 },
      { id: "k-green", name: "Green", rating: 67.0, slope: 127, par: 72 },
      { id: "k-greencopperm", name: "Green/Copper (M)", rating: 65.5, slope: 123, par: 72 },
      { id: "k-greencopperw", name: "Green/Copper (W)", rating: 69.7, slope: 121, par: 72 },
      { id: "k-copperm", name: "Copper (M)", rating: 64.2, slope: 120, par: 72 },
      { id: "k-copperw", name: "Copper (W)", rating: 68.1, slope: 118, par: 72 },
    ],
  },
};

function findTee(courses, courseName, teeId) {
  const course = courses[courseName];
  if (!course) return null;
  return course.tees.find((t) => t.id === teeId) || null;
}

function courseHandicap(index, tee) {
  if (!tee) return null;
  return Math.round(index * (tee.slope / 113) + (tee.rating - tee.par));
}

function strokesReceived(player, tee, courseStrokeIndex, holeIdx) {
  const hcp = courseHandicap(player.index, tee);
  if (hcp == null) return 0;
  const si = courseStrokeIndex ? courseStrokeIndex[holeIdx] : holeIdx + 1;
  const base = Math.floor(hcp / 18);
  const extra = si <= ((hcp % 18) + 18) % 18 ? 1 : 0;
  return base + extra;
}

const defaultRounds = [
  { id: 1, label: "AM Best Ball", format: "bestball", holes: 18, course: "Keep" },
  { id: 2, label: "PM Best Ball", format: "bestball", holes: 18, course: "Highlands" },
  { id: 3, label: "Singles", format: "singles", holes: 18, course: "Keep" },
];

function emptyScores(holes) {
  return Array.from({ length: holes }, () => ({}));
}

function matchSize(format) {
  return format === "bestball" ? 2 : 1;
}

function emptyPairings() {
  return { matches: [] };
}

function buildMatchesFromPairings(pairings, players, format) {
  if (!pairings || !pairings.matches) return [];
  const byId = {};
  players.forEach((p) => (byId[p.id] = p));
  return pairings.matches.map((m) => ({
    id: m.id,
    teeId: m.teeId || null,
    side1: m.side1.map((id) => byId[id]).filter(Boolean),
    side2: m.side2.map((id) => byId[id]).filter(Boolean),
  }));
}

function pairingsComplete(pairings, players, format) {
  const size = matchSize(format);
  const numMatches = players.length / 2 / size;
  return (pairings?.matches?.length || 0) === numMatches;
}

function unassignedPlayers(pairings, players, team) {
  const used = new Set();
  (pairings?.matches || []).forEach((m) => {
    m.side1.forEach((id) => used.add(id));
    m.side2.forEach((id) => used.add(id));
  });
  return players.filter((p) => p.team === team && !used.has(p.id));
}

function netBestBallScore(players, tee, courseStrokeIndex, scores, holeIdx) {
  const nets = players.map((p) => {
    const gross = scores?.[holeIdx]?.[p.id];
    if (gross == null) return null;
    return gross - strokesReceived(p, tee, courseStrokeIndex, holeIdx);
  });
  if (nets.some((n) => n == null)) return null;
  return Math.min(...nets);
}

function netSinglesScore(player, tee, courseStrokeIndex, scores, holeIdx) {
  const gross = scores?.[holeIdx]?.[player.id];
  if (gross == null) return null;
  return gross - strokesReceived(player, tee, courseStrokeIndex, holeIdx);
}

function matchPlayState(match, round, scores, courses) {
  const { format, holes } = round;
  const tee = findTee(courses, round.course, match.teeId);
  const courseStrokeIndex = courses[round.course]?.strokeIndex;
  let diff = 0;
  let holesPlayed = 0;
  let decided = false;
  let decidedAt = null;

  for (let h = 0; h < holes; h++) {
    let s1, s2;
    if (format === "bestball") {
      s1 = netBestBallScore(match.side1, tee, courseStrokeIndex, scores, h);
      s2 = netBestBallScore(match.side2, tee, courseStrokeIndex, scores, h);
    } else {
      s1 = netSinglesScore(match.side1[0], tee, courseStrokeIndex, scores, h);
      s2 = netSinglesScore(match.side2[0], tee, courseStrokeIndex, scores, h);
    }
    if (s1 == null || s2 == null) break;
    holesPlayed = h + 1;
    if (s1 < s2) diff += 1;
    else if (s2 < s1) diff -= 1;

    const remaining = holes - holesPlayed;
    if (!decided && Math.abs(diff) > remaining) {
      decided = true;
      decidedAt = holesPlayed;
    }
  }

  let label;
  if (holesPlayed === 0) label = "Not started";
  else if (diff === 0) label = "All Square";
  else label = `${Math.abs(diff)} UP`;

  let points1 = 0,
    points2 = 0,
    final = holesPlayed === holes || decided;
  if (final) {
    if (diff > 0) points1 = 1;
    else if (diff < 0) points2 = 1;
    else {
      points1 = 0.5;
      points2 = 0.5;
    }
  }

  return {
    diff,
    holesPlayed,
    label: decided ? `${label} (won thru ${decidedAt})` : label,
    final,
    points1,
    points2,
    leader: diff > 0 ? "side1" : diff < 0 ? "side2" : null,
    tee,
  };
}

function scoresKey(roundId) {
  return `${TOURNAMENT_ID}:scores:round-${roundId}`;
}
function pairingsKey(roundId) {
  return `${TOURNAMENT_ID}:pairings:round-${roundId}`;
}
function coursesKey() {
  return `${TOURNAMENT_ID}:courses`;
}

async function loadJSON(key, fallback) {
  try {
    const { data, error } = await supabase
      .from("tournament_kv")
      .select("value")
      .eq("key", key)
      .maybeSingle();
    if (error) throw error;
    if (data && data.value != null) return data.value;
  } catch (e) {
    console.error("Failed to load", key, e);
  }
  return fallback;
}

async function saveJSON(key, value) {
  try {
    const { error } = await supabase
      .from("tournament_kv")
      .upsert({ key, value, updated_at: new Date().toISOString() });
    if (error) throw error;
    return { ok: true };
  } catch (e) {
    console.error("Failed to save", key, e);
    return { ok: false, error: e?.message || String(e) };
  }
}

function TabButton({ active, onClick, children }) {
  return (
    <button
      onClick={onClick}
      style={{
        fontFamily: SERIF,
        fontSize: 15,
        letterSpacing: "0.04em",
        padding: "10px 18px",
        background: active ? COLORS.fairway : "transparent",
        color: active ? COLORS.cream : COLORS.fairway,
        border: `1px solid ${COLORS.fairway}`,
        borderRadius: 2,
        cursor: "pointer",
        textTransform: "uppercase",
      }}
    >
      {children}
    </button>
  );
}

function SectionLabel({ children }) {
  return (
    <div
      style={{
        fontFamily: MONO,
        fontSize: 11,
        letterSpacing: "0.18em",
        textTransform: "uppercase",
        color: COLORS.tan,
        marginBottom: 10,
        borderBottom: `1px solid ${COLORS.line}`,
        paddingBottom: 8,
      }}
    >
      {children}
    </div>
  );
}

function LiveDot({ syncing }) {
  return (
    <div
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        fontFamily: MONO,
        fontSize: 11,
        color: "#8a8470",
        letterSpacing: "0.08em",
      }}
    >
      <span
        style={{
          width: 7,
          height: 7,
          borderRadius: "50%",
          background: syncing ? COLORS.tan : "#4f9d6e",
          display: "inline-block",
          transition: "background 0.3s",
        }}
      />
      {syncing ? "syncing" : "live"}
    </div>
  );
}

export default function GolfTracker() {
  const [players] = useState(defaultPlayers);
  const [rounds, setRounds] = useState(defaultRounds);
  const [courses, setCourses] = useState(defaultCourses);
  const [activeRound, setActiveRound] = useState(0);
  const [tab, setTab] = useState("leaderboard");
  const [myMatchId, setMyMatchId] = useState(null);
  const [scoresByRound, setScoresByRound] = useState(() => {
    const init = {};
    defaultRounds.forEach((r) => (init[r.id] = emptyScores(r.holes)));
    return init;
  });
  const [pairingsByRound, setPairingsByRound] = useState(() => {
    const init = {};
    defaultRounds.forEach((r) => (init[r.id] = emptyPairings()));
    return init;
  });
  const [loaded, setLoaded] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [saveError, setSaveError] = useState(null);

  const matchesByRound = useMemo(() => {
    const m = {};
    rounds.forEach((r) => {
      m[r.id] = buildMatchesFromPairings(pairingsByRound[r.id], players, r.format);
    });
    return m;
  }, [rounds, pairingsByRound, players]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const nextScores = {};
      const nextPairings = {};
      for (const r of rounds) {
        nextScores[r.id] = await loadJSON(scoresKey(r.id), emptyScores(r.holes));
        nextPairings[r.id] = await loadJSON(pairingsKey(r.id), emptyPairings());
      }
      const loadedCourses = await loadJSON(coursesKey(), defaultCourses);
      if (!cancelled) {
        setScoresByRound(nextScores);
        setPairingsByRound(nextPairings);
        setCourses(loadedCourses);
        setLoaded(true);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!loaded) return;
    const interval = setInterval(async () => {
      setSyncing(true);
      const nextScores = {};
      const nextPairings = {};
      for (const r of rounds) {
        nextScores[r.id] = await loadJSON(scoresKey(r.id), emptyScores(r.holes));
        nextPairings[r.id] = await loadJSON(pairingsKey(r.id), emptyPairings());
      }
      const loadedCourses = await loadJSON(coursesKey(), defaultCourses);
      setScoresByRound(nextScores);
      setPairingsByRound(nextPairings);
      setCourses(loadedCourses);
      setSyncing(false);
    }, POLL_MS);
    return () => clearInterval(interval);
  }, [loaded, rounds]);

  const totalPoints = useMemo(() => {
    let a = 0,
      b = 0;
    rounds.forEach((r) => {
      const matches = matchesByRound[r.id];
      const scores = scoresByRound[r.id] || emptyScores(r.holes);
      matches.forEach((match) => {
        const state = matchPlayState(match, r, scores, courses);
        a += state.points1;
        b += state.points2;
      });
    });
    const possible = rounds.reduce((sum, r) => {
      const size = matchSize(r.format);
      return sum + players.length / 2 / size;
    }, 0);
    return { a, b, possible };
  }, [rounds, matchesByRound, scoresByRound, players, courses]);

  function updateScore(roundId, holeIdx, playerId, value) {
    setScoresByRound((prev) => {
      const next = { ...prev };
      const holesArr = next[roundId].map((h) => ({ ...h }));
      holesArr[holeIdx][playerId] = value === "" ? undefined : parseInt(value, 10);
      next[roundId] = holesArr;
      saveJSON(scoresKey(roundId), holesArr);
      return next;
    });
  }

  function savePairings(roundId, updated) {
    setPairingsByRound((prev) => ({ ...prev, [roundId]: updated }));
    saveJSON(pairingsKey(roundId), updated).then((res) => {
      if (!res.ok) setSaveError(`Couldn't save pairings: ${res.error}`);
      else setSaveError(null);
    });
  }

  function saveCourses(updated) {
    setCourses(updated);
    saveJSON(coursesKey(), updated);
  }

  const round = rounds[activeRound];
  const matches = matchesByRound[round.id];
  const scores = scoresByRound[round.id];
  const pairings = pairingsByRound[round.id];
  const winNeeded = totalPoints.possible / 2 + 0.5;

  if (!loaded) {
    return (
      <div
        style={{
          minHeight: "100vh",
          background: COLORS.cream,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontFamily: MONO,
          color: COLORS.fairway,
        }}
      >
        loading scores…
      </div>
    );
  }

  return (
    <div
      style={{
        minHeight: "100vh",
        background: COLORS.cream,
        color: COLORS.ink,
        fontFamily: SERIF,
        padding: "32px 20px 60px",
      }}
    >
      <div style={{ maxWidth: 980, margin: "0 auto 28px" }}>
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "flex-end",
            borderBottom: `3px solid ${COLORS.fairway}`,
            paddingBottom: 14,
          }}
        >
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 4 }}>
              <div
                style={{
                  fontFamily: MONO,
                  fontSize: 11,
                  letterSpacing: "0.22em",
                  color: COLORS.tan,
                  textTransform: "uppercase",
                }}
              >
                Live Tournament
              </div>
              <LiveDot syncing={syncing} />
            </div>
            <h1 style={{ margin: 0, fontSize: 34, fontWeight: 600 }}>The Guyder Cup</h1>
          </div>
          <div style={{ textAlign: "right" }}>
            <Scoreline totalPoints={totalPoints} winNeeded={winNeeded} />
          </div>
        </div>
      </div>

      <div style={{ maxWidth: 980, margin: "0 auto 24px", display: "flex", gap: 8, flexWrap: "wrap" }}>
        <TabButton active={tab === "leaderboard"} onClick={() => setTab("leaderboard")}>
          Leaderboard
        </TabButton>
        <TabButton active={tab === "score"} onClick={() => setTab("score")}>
          Enter Scores
        </TabButton>
        <TabButton active={tab === "pairings"} onClick={() => setTab("pairings")}>
          Pairings
        </TabButton>
        <TabButton active={tab === "setup"} onClick={() => setTab("setup")}>
          Format & Players
        </TabButton>
      </div>

      {saveError && (
        <div
          style={{
            maxWidth: 980,
            margin: "0 auto 20px",
            background: "#fdeceb",
            border: `1px solid ${COLORS.flag}`,
            color: COLORS.flag,
            borderRadius: 3,
            padding: "10px 14px",
            fontFamily: MONO,
            fontSize: 12,
          }}
        >
          {saveError}
        </div>
      )}

      <div style={{ maxWidth: 980, margin: "0 auto" }}>
        {tab === "leaderboard" && (
          <Leaderboard rounds={rounds} matchesByRound={matchesByRound} scoresByRound={scoresByRound} courses={courses} />
        )}

        {tab === "score" && (
          <ScoreEntry
            rounds={rounds}
            activeRound={activeRound}
            setActiveRound={setActiveRound}
            round={round}
            matches={matches}
            scores={scores}
            updateScore={updateScore}
            myMatchId={myMatchId}
            setMyMatchId={setMyMatchId}
            courses={courses}
          />
        )}

        {tab === "pairings" && (
          <Pairings
            rounds={rounds}
            activeRound={activeRound}
            setActiveRound={setActiveRound}
            round={round}
            players={players}
            pairings={pairings}
            savePairings={savePairings}
            courses={courses}
          />
        )}

        {tab === "setup" && (
          <Setup
            players={players}
            rounds={rounds}
            setRounds={setRounds}
            alternates={alternates}
            courses={courses}
            saveCourses={saveCourses}
          />
        )}
      </div>
    </div>
  );
}

function Scoreline({ totalPoints, winNeeded }) {
  return (
    <div style={{ display: "flex", gap: 22, alignItems: "baseline" }}>
      <TeamScore label="Booth" value={totalPoints.a} color={COLORS.fairway} />
      <div style={{ fontFamily: MONO, fontSize: 13, color: COLORS.tan }}>first to {winNeeded}</div>
      <TeamScore label="Fish" value={totalPoints.b} color={COLORS.flag} />
    </div>
  );
}

function TeamScore({ label, value, color }) {
  return (
    <div style={{ textAlign: "center" }}>
      <div
        style={{
          fontFamily: MONO,
          fontSize: 11,
          letterSpacing: "0.12em",
          textTransform: "uppercase",
          color: "#8a8470",
        }}
      >
        {label}
      </div>
      <div style={{ fontFamily: MONO, fontSize: 30, color, fontWeight: 700 }}>{value}</div>
    </div>
  );
}

function Leaderboard({ rounds, matchesByRound, scoresByRound, courses }) {
  return (
    <div>
      <SectionLabel>Match Status by Round</SectionLabel>
      <div style={{ display: "grid", gap: 18 }}>
        {rounds.map((r) => {
          const matches = matchesByRound[r.id];
          const scores = scoresByRound[r.id] || emptyScores(r.holes);
          return (
            <div key={r.id} style={{ background: "#fff", border: `1px solid ${COLORS.line}`, borderRadius: 3 }}>
              <div
                style={{
                  padding: "10px 16px",
                  background: COLORS.fairway,
                  color: COLORS.cream,
                  fontFamily: MONO,
                  fontSize: 12,
                  letterSpacing: "0.1em",
                  textTransform: "uppercase",
                  display: "flex",
                  justifyContent: "space-between",
                  flexWrap: "wrap",
                  gap: 6,
                }}
              >
                <span>{r.label}</span>
                <span>
                  {r.format === "bestball" ? "Best Ball · Match Play" : "Singles · Match Play"} · {r.holes} holes ·{" "}
                  {r.course}
                </span>
              </div>
              <div>
                {matches.length === 0 && (
                  <div style={{ padding: "16px", fontFamily: MONO, fontSize: 13, color: "#a39c87" }}>
                    Pairings not yet set for this round.
                  </div>
                )}
                {matches.map((m, idx) => {
                  const state = matchPlayState(m, r, scores, courses);
                  return (
                    <div
                      key={m.id}
                      style={{
                        display: "grid",
                        gridTemplateColumns: "1fr auto 1fr",
                        alignItems: "center",
                        padding: "12px 16px",
                        borderTop: idx === 0 ? "none" : `1px solid ${COLORS.line}`,
                        gap: 12,
                      }}
                    >
                      <div style={{ textAlign: "right", fontWeight: state.leader === "side1" ? 700 : 400 }}>
                        {m.side1.map((p) => p.name).join(" / ")}
                      </div>
                      <div
                        style={{
                          fontFamily: MONO,
                          fontSize: 13,
                          textAlign: "center",
                          minWidth: 150,
                          color: state.holesPlayed === 0 ? "#a39c87" : COLORS.ink,
                          background: COLORS.cream,
                          border: `1px solid ${COLORS.line}`,
                          borderRadius: 3,
                          padding: "4px 8px",
                        }}
                      >
                        <div>
                          {state.label}
                          {state.holesPlayed > 0 && ` · thru ${state.holesPlayed}`}
                        </div>
                        {state.tee && (
                          <div style={{ fontSize: 10, color: "#a39c87", marginTop: 2 }}>{state.tee.name} tees</div>
                        )}
                      </div>
                      <div style={{ fontWeight: state.leader === "side2" ? 700 : 400 }}>
                        {m.side2.map((p) => p.name).join(" / ")}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function ScoreEntry({
  rounds,
  activeRound,
  setActiveRound,
  round,
  matches,
  scores,
  updateScore,
  myMatchId,
  setMyMatchId,
  courses,
}) {
  const [holeIdx, setHoleIdx] = useState(0);
  const myMatch = matches.find((m) => m.id === myMatchId);
  const tee = myMatch ? findTee(courses, round.course, myMatch.teeId) : null;

  return (
    <div>
      <div style={{ display: "flex", gap: 8, marginBottom: 18, flexWrap: "wrap" }}>
        {rounds.map((r, i) => (
          <TabButton
            key={r.id}
            active={i === activeRound}
            onClick={() => {
              setActiveRound(i);
              setHoleIdx(0);
              setMyMatchId(null);
            }}
          >
            {r.label}
          </TabButton>
        ))}
      </div>

      {matches.length === 0 ? (
        <div
          style={{
            background: "#fff",
            border: `1px solid ${COLORS.line}`,
            borderRadius: 3,
            padding: "20px",
            fontFamily: MONO,
            fontSize: 13,
            color: "#a39c87",
          }}
        >
          The captains haven't set pairings for {round.label} yet. Check the Pairings tab.
        </div>
      ) : !myMatch ? (
        <MatchPicker round={round} matches={matches} scores={scores} onPick={setMyMatchId} courses={courses} />
      ) : (
        <div>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10, flexWrap: "wrap", gap: 8 }}>
            <SectionLabel>
              {round.label} ({round.course}{tee ? `, ${tee.name} tees` : ""}) — Hole {holeIdx + 1} of {round.holes}
            </SectionLabel>
            <button
              onClick={() => setMyMatchId(null)}
              style={{
                fontFamily: MONO,
                fontSize: 11,
                color: COLORS.tan,
                background: "transparent",
                border: "none",
                cursor: "pointer",
                marginBottom: 10,
                whiteSpace: "nowrap",
              }}
            >
              switch match
            </button>
          </div>

          {!tee && (
            <div style={{ fontFamily: MONO, fontSize: 12, color: COLORS.flag, marginBottom: 14 }}>
              No tee set for this match yet — strokes can't be calculated until the captain picks a
              tee in the Pairings tab.
            </div>
          )}

          <div style={{ display: "flex", gap: 8, marginBottom: 18, flexWrap: "wrap" }}>
            {Array.from({ length: round.holes }, (_, h) => (
              <button
                key={h}
                onClick={() => setHoleIdx(h)}
                style={{
                  width: 30,
                  height: 30,
                  fontFamily: MONO,
                  fontSize: 12,
                  border: `1px solid ${COLORS.line}`,
                  background: h === holeIdx ? COLORS.tan : "#fff",
                  color: h === holeIdx ? "#fff" : COLORS.ink,
                  cursor: "pointer",
                  borderRadius: 2,
                }}
              >
                {h + 1}
              </button>
            ))}
          </div>

          <div style={{ background: "#fff", border: `1px solid ${COLORS.line}`, borderRadius: 3, padding: "14px 16px" }}>
            <div style={{ display: "flex", gap: 24, flexWrap: "wrap" }}>
              <MatchSidePlayers players={myMatch.side1} holeIdx={holeIdx} scores={scores} round={round} updateScore={updateScore} tee={tee} courseStrokeIndex={courses[round.course]?.strokeIndex} />
              <div style={{ width: 1, background: COLORS.line, alignSelf: "stretch" }} />
              <MatchSidePlayers players={myMatch.side2} holeIdx={holeIdx} scores={scores} round={round} updateScore={updateScore} tee={tee} courseStrokeIndex={courses[round.course]?.strokeIndex} />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function MatchPicker({ round, matches, scores, onPick, courses }) {
  return (
    <div>
      <SectionLabel>Which match are you scoring? — {round.label}</SectionLabel>
      <div style={{ display: "grid", gap: 10 }}>
        {matches.map((m) => {
          const state = matchPlayState(m, round, scores, courses);
          return (
            <button
              key={m.id}
              onClick={() => onPick(m.id)}
              style={{
                display: "grid",
                gridTemplateColumns: "1fr auto 1fr",
                alignItems: "center",
                gap: 12,
                padding: "14px 16px",
                background: "#fff",
                border: `1px solid ${COLORS.line}`,
                borderRadius: 3,
                cursor: "pointer",
                fontFamily: SERIF,
                fontSize: 15,
                textAlign: "left",
              }}
            >
              <div style={{ textAlign: "right" }}>{m.side1.map((p) => p.name).join(" / ")}</div>
              <div style={{ fontFamily: MONO, fontSize: 12, color: "#8a8470", minWidth: 100, textAlign: "center" }}>
                <div>{state.holesPlayed > 0 ? `thru ${state.holesPlayed}` : "not started"}</div>
                {state.tee && <div style={{ fontSize: 10 }}>{state.tee.name} tees</div>}
              </div>
              <div>{m.side2.map((p) => p.name).join(" / ")}</div>
            </button>
          );
        })}
      </div>
      <div style={{ fontFamily: MONO, fontSize: 12, color: "#8a8470", marginTop: 14 }}>
        Pick the match you're playing in.
      </div>
    </div>
  );
}

function MatchSidePlayers({ players, holeIdx, scores, round, updateScore, tee, courseStrokeIndex }) {
  return (
    <div style={{ flex: 1, minWidth: 200, display: "grid", gap: 8 }}>
      {players.map((p) => {
        const strokes = tee ? strokesReceived(p, tee, courseStrokeIndex, holeIdx) : 0;
        const hcp = tee ? courseHandicap(p.index, tee) : null;
        const gross = scores?.[holeIdx]?.[p.id];
        return (
          <div key={p.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10 }}>
            <div>
              <div style={{ fontWeight: 600 }}>{p.name}</div>
              <div style={{ fontFamily: MONO, fontSize: 11, color: "#8a8470" }}>
                index {p.index}
                {hcp != null ? ` · course hcp ${hcp}` : ""}
                {strokes > 0 ? ` · +${strokes} this hole` : ""}
              </div>
            </div>
            <input
              type="number"
              min={1}
              max={15}
              value={gross ?? ""}
              onChange={(e) => updateScore(round.id, holeIdx, p.id, e.target.value)}
              placeholder="—"
              style={{
                width: 48,
                height: 36,
                textAlign: "center",
                fontFamily: MONO,
                fontSize: 16,
                border: `1px solid ${COLORS.line}`,
                borderRadius: 3,
              }}
            />
          </div>
        );
      })}
    </div>
  );
}

function Pairings({ rounds, activeRound, setActiveRound, round, players, pairings, savePairings, courses }) {
  const size = matchSize(round.format);
  const numMatches = players.length / 2 / size;
  const complete = pairingsComplete(pairings, players, round.format);
  const matches = buildMatchesFromPairings(pairings, players, round.format);
  const availableTees = courses[round.course]?.tees || [];

  const [selBooth, setSelBooth] = useState([]);
  const [selFish, setSelFish] = useState([]);
  const [newTeeId, setNewTeeId] = useState(availableTees[0]?.id || "");

  useEffect(() => {
    setSelBooth([]);
    setSelFish([]);
    setNewTeeId(availableTees[0]?.id || "");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [round.id]);

  const unBooth = unassignedPlayers(pairings, players, TEAM_BOOTH);
  const unFish = unassignedPlayers(pairings, players, TEAM_FISH);

  function toggleSelect(list, setList, playerId) {
    setList((prev) => {
      if (prev.includes(playerId)) return prev.filter((id) => id !== playerId);
      if (prev.length >= size) return prev;
      return [...prev, playerId];
    });
  }

  function addMatch() {
    if (selBooth.length !== size || selFish.length !== size) return;
    const newMatch = {
      id: `m-${Date.now()}`,
      side1: selBooth,
      side2: selFish,
      teeId: newTeeId || null,
    };
    const updated = { matches: [...(pairings?.matches || []), newMatch] };
    savePairings(round.id, updated);
    setSelBooth([]);
    setSelFish([]);
  }

  function removeMatch(matchId) {
    const updated = { matches: (pairings?.matches || []).filter((m) => m.id !== matchId) };
    savePairings(round.id, updated);
  }

  function changeTee(matchId, teeId) {
    const updated = {
      matches: (pairings?.matches || []).map((m) => (m.id === matchId ? { ...m, teeId } : m)),
    };
    savePairings(round.id, updated);
  }

  return (
    <div>
      <div style={{ display: "flex", gap: 8, marginBottom: 18, flexWrap: "wrap" }}>
        {rounds.map((r, i) => (
          <TabButton key={r.id} active={i === activeRound} onClick={() => setActiveRound(i)}>
            {r.label}
          </TabButton>
        ))}
      </div>

      <SectionLabel>
        {round.label} — {round.format === "bestball" ? "two-man teams" : "singles"} ({round.course}) ·{" "}
        {complete ? `all ${numMatches} matches set` : `${matches.length} of ${numMatches} set`}
      </SectionLabel>

      {matches.length > 0 && (
        <div style={{ display: "grid", gap: 10, marginBottom: 22 }}>
          {matches.map((m) => (
            <div
              key={m.id}
              style={{
                display: "grid",
                gridTemplateColumns: "1fr auto auto",
                alignItems: "center",
                gap: 10,
                background: "#fff",
                border: `1px solid ${COLORS.line}`,
                borderRadius: 3,
                padding: "10px 14px",
              }}
            >
              <div style={{ fontFamily: SERIF, fontSize: 14 }}>
                {m.side1.map((p) => p.name).join(" / ")}
                <span style={{ color: "#a39c87" }}> vs </span>
                {m.side2.map((p) => p.name).join(" / ")}
              </div>
              <select
                value={m.teeId || ""}
                onChange={(e) => changeTee(m.id, e.target.value)}
                style={{ fontFamily: MONO, fontSize: 12, padding: "5px 8px", border: `1px solid ${COLORS.line}`, borderRadius: 3 }}
              >
                <option value="">no tee set</option>
                {availableTees.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name} tees
                  </option>
                ))}
              </select>
              <button
                onClick={() => removeMatch(m.id)}
                style={{ border: "none", background: "transparent", color: COLORS.flag, cursor: "pointer", fontFamily: MONO, fontSize: 11 }}
              >
                remove
              </button>
            </div>
          ))}
        </div>
      )}

      {!complete && (
        <div style={{ background: "#fff", border: `1px dashed ${COLORS.fairway}`, borderRadius: 3, padding: "16px" }}>
          <div style={{ fontFamily: MONO, fontSize: 12, color: "#8a8470", marginBottom: 12 }}>
            Tap {size === 2 ? "two" : "one"} player{size === 2 ? "s" : ""} from each team to build the next match.
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20, marginBottom: 14 }}>
            <PlayerPicker color={COLORS.fairway} list={unBooth} selected={selBooth} onToggle={(id) => toggleSelect(selBooth, setSelBooth, id)} />
            <PlayerPicker color={COLORS.flag} list={unFish} selected={selFish} onToggle={(id) => toggleSelect(selFish, setSelFish, id)} />
          </div>
          <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
            <select
              value={newTeeId}
              onChange={(e) => setNewTeeId(e.target.value)}
              style={{ fontFamily: MONO, fontSize: 13, padding: "8px 10px", border: `1px solid ${COLORS.line}`, borderRadius: 3 }}
            >
              <option value="">no tee set</option>
              {availableTees.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name} tees
                </option>
              ))}
            </select>
            <button
              onClick={addMatch}
              disabled={selBooth.length !== size || selFish.length !== size}
              style={{
                fontFamily: MONO,
                fontSize: 13,
                padding: "10px 16px",
                background: selBooth.length === size && selFish.length === size ? COLORS.fairway : "#ddd6c4",
                color: selBooth.length === size && selFish.length === size ? COLORS.cream : "#a39c87",
                border: "none",
                borderRadius: 3,
                cursor: selBooth.length === size && selFish.length === size ? "pointer" : "default",
              }}
            >
              + add match
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function PlayerPicker({ color, list, selected, onToggle }) {
  return (
    <div style={{ display: "grid", gap: 6 }}>
      {list.map((p) => {
        const isSel = selected.includes(p.id);
        return (
          <button
            key={p.id}
            onClick={() => onToggle(p.id)}
            style={{
              textAlign: "left",
              fontFamily: SERIF,
              fontSize: 14,
              padding: "8px 10px",
              border: `1px solid ${isSel ? color : COLORS.line}`,
              background: isSel ? color : "#fff",
              color: isSel ? "#fff" : COLORS.ink,
              borderRadius: 3,
              cursor: "pointer",
            }}
          >
            {p.name}
          </button>
        );
      })}
      {list.length === 0 && (
        <div style={{ fontFamily: MONO, fontSize: 12, color: "#a39c87", padding: "8px 0" }}>
          everyone's assigned
        </div>
      )}
    </div>
  );
}

function Setup({ players, rounds, setRounds, alternates, courses, saveCourses }) {
  function updateRoundField(roundId, field, value) {
    setRounds((prev) => prev.map((r) => (r.id === roundId ? { ...r, [field]: value } : r)));
  }

  const boothPlayers = players.filter((p) => p.team === TEAM_BOOTH);
  const fishPlayers = players.filter((p) => p.team === TEAM_FISH);
  const totalHoles = rounds.reduce((s, r) => s + r.holes, 0);

  function updateTee(courseName, teeId, field, value) {
    const updated = {
      ...courses,
      [courseName]: {
        ...courses[courseName],
        tees: courses[courseName].tees.map((t) =>
          t.id === teeId ? { ...t, [field]: field === "name" ? value : parseFloat(value) || 0 } : t
        ),
      },
    };
    saveCourses(updated);
  }

  function addTee(courseName) {
    const newTee = { id: `tee-${Date.now()}`, name: "New", rating: 72.0, slope: 130, par: 72 };
    const updated = {
      ...courses,
      [courseName]: { ...courses[courseName], tees: [...courses[courseName].tees, newTee] },
    };
    saveCourses(updated);
  }

  function removeTee(courseName, teeId) {
    const updated = {
      ...courses,
      [courseName]: { ...courses[courseName], tees: courses[courseName].tees.filter((t) => t.id !== teeId) },
    };
    saveCourses(updated);
  }

  return (
    <div style={{ display: "grid", gap: 30 }}>
      <div>
        <SectionLabel>Event Format — {totalHoles} holes total</SectionLabel>
        <div style={{ display: "grid", gap: 10 }}>
          {rounds.map((r) => (
            <div
              key={r.id}
              style={{
                display: "flex",
                gap: 12,
                alignItems: "center",
                background: "#fff",
                border: `1px solid ${COLORS.line}`,
                borderRadius: 3,
                padding: "10px 14px",
                flexWrap: "wrap",
              }}
            >
              <input
                value={r.label}
                onChange={(e) => updateRoundField(r.id, "label", e.target.value)}
                style={{ fontFamily: SERIF, fontWeight: 600, border: "none", background: "transparent", fontSize: 15, width: 130 }}
              />
              <select
                value={r.format}
                onChange={(e) => updateRoundField(r.id, "format", e.target.value)}
                style={{ fontFamily: MONO, fontSize: 13, padding: "6px 8px", border: `1px solid ${COLORS.line}`, borderRadius: 3 }}
              >
                <option value="bestball">Two-man best ball (match play)</option>
                <option value="singles">Singles (match play)</option>
              </select>
              <select
                value={r.holes}
                onChange={(e) => updateRoundField(r.id, "holes", parseInt(e.target.value, 10))}
                style={{ fontFamily: MONO, fontSize: 13, padding: "6px 8px", border: `1px solid ${COLORS.line}`, borderRadius: 3 }}
              >
                <option value={9}>9 holes</option>
                <option value={18}>18 holes</option>
              </select>
              <select
                value={r.course}
                onChange={(e) => updateRoundField(r.id, "course", e.target.value)}
                style={{ fontFamily: MONO, fontSize: 13, padding: "6px 8px", border: `1px solid ${COLORS.line}`, borderRadius: 3 }}
              >
                {Object.keys(courses).map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </div>
          ))}
        </div>
        <div style={{ fontFamily: MONO, fontSize: 12, color: "#8a8470", marginTop: 10 }}>
          Each round is tied to a course. The specific tee each match plays is set per-match in
          the Pairings tab — matches in the same round can play different tees.
        </div>
      </div>

      <div>
        <SectionLabel>Courses & Tees</SectionLabel>
        <div style={{ display: "grid", gap: 18 }}>
          {Object.entries(courses).map(([courseName, course]) => (
            <div key={courseName} style={{ background: "#fff", border: `1px solid ${COLORS.line}`, borderRadius: 3, padding: "14px 16px" }}>
              <div style={{ fontFamily: SERIF, fontWeight: 600, fontSize: 16, marginBottom: 10 }}>{courseName}</div>
              <div style={{ display: "grid", gap: 8 }}>
                {course.tees.map((t) => (
                  <div key={t.id} style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
                    <input
                      value={t.name}
                      onChange={(e) => updateTee(courseName, t.id, "name", e.target.value)}
                      placeholder="Tee name"
                      style={{ width: 80, fontFamily: SERIF, fontSize: 14, border: `1px solid ${COLORS.line}`, borderRadius: 3, padding: "5px 8px" }}
                    />
                    <LabeledNumber label="Rating" value={t.rating} step={0.1} onChange={(v) => updateTee(courseName, t.id, "rating", v)} />
                    <LabeledNumber label="Slope" value={t.slope} step={1} onChange={(v) => updateTee(courseName, t.id, "slope", v)} />
                    <LabeledNumber label="Par" value={t.par} step={1} onChange={(v) => updateTee(courseName, t.id, "par", v)} />
                    <button
                      onClick={() => removeTee(courseName, t.id)}
                      style={{ border: "none", background: "transparent", color: COLORS.flag, cursor: "pointer", fontFamily: MONO, fontSize: 11 }}
                    >
                      remove
                    </button>
                  </div>
                ))}
                <button
                  onClick={() => addTee(courseName)}
                  style={{
                    fontFamily: MONO,
                    fontSize: 12,
                    padding: "8px",
                    background: "transparent",
                    border: `1px dashed ${COLORS.fairway}`,
                    color: COLORS.fairway,
                    cursor: "pointer",
                    borderRadius: 3,
                    width: "fit-content",
                  }}
                >
                  + add tee
                </button>
              </div>
            </div>
          ))}
        </div>
        <div style={{ fontFamily: MONO, fontSize: 12, color: "#8a8470", marginTop: 10 }}>
          Course handicap = Index × (Slope / 113) + (Rating − Par), computed live per match using
          whichever tee that match selected.
        </div>
      </div>

      <div>
        <SectionLabel>Roster & Handicap Index</SectionLabel>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20 }}>
          {[
            { label: "Booth", color: COLORS.fairway, list: boothPlayers },
            { label: "Fish", color: COLORS.flag, list: fishPlayers },
          ].map(({ label, color, list }) => (
            <div key={label}>
              <div style={{ fontFamily: MONO, fontSize: 12, letterSpacing: "0.1em", marginBottom: 8, color }}>
                TEAM {label.toUpperCase()}
              </div>
              <div style={{ display: "grid", gap: 6 }}>
                {list.map((p) => (
                  <div
                    key={p.id}
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      background: "#fff",
                      border: `1px solid ${COLORS.line}`,
                      borderRadius: 3,
                      padding: "6px 10px",
                      fontFamily: MONO,
                      fontSize: 12,
                    }}
                  >
                    <span style={{ fontFamily: SERIF, fontSize: 14 }}>{p.name}</span>
                    <span style={{ color: "#8a8470" }}>index {p.index}</span>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
        {alternates.length > 0 && (
          <div style={{ fontFamily: MONO, fontSize: 12, color: "#8a8470", marginTop: 12 }}>
            Alternate: {alternates.map((a) => a.name).join(", ")}
          </div>
        )}
      </div>
    </div>
  );
}

function LabeledNumber({ label, value, step, onChange }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
      <span style={{ fontFamily: MONO, fontSize: 11, color: "#8a8470" }}>{label}</span>
      <input
        type="number"
        step={step}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        style={{ width: 60, fontFamily: MONO, fontSize: 13, border: `1px solid ${COLORS.line}`, borderRadius: 3, padding: "5px 6px" }}
      />
    </div>
  );
}
