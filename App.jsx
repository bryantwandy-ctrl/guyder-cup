import React, { useState, useMemo, useEffect, useRef } from "react";
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

const TOURNAMENT_ID = "guyder-cup-2026"; // change per event to keep tournaments separate
const POLL_MS = 5000;

const TEAM_BOOTH = "Booth";
const TEAM_FISH = "Fish";

// ---------- Roster (from McLemore Civil War 2026 sheet) ----------
// hcpHighlands / hcpKeep are already-converted course handicaps, not index.
const defaultPlayers = [
  { id: 1, name: "Booth", team: TEAM_BOOTH, hcpHighlands: 21, hcpKeep: 21 },
  { id: 2, name: "Clinton", team: TEAM_BOOTH, hcpHighlands: 6, hcpKeep: 6 },
  { id: 3, name: "Niemeyer", team: TEAM_BOOTH, hcpHighlands: 10, hcpKeep: 10 },
  { id: 4, name: "Rams", team: TEAM_BOOTH, hcpHighlands: 14, hcpKeep: 14 },
  { id: 5, name: "Rio", team: TEAM_BOOTH, hcpHighlands: 15, hcpKeep: 15 },
  { id: 6, name: "AB", team: TEAM_BOOTH, hcpHighlands: 22, hcpKeep: 22 },
  { id: 7, name: "Bobby", team: TEAM_BOOTH, hcpHighlands: 25, hcpKeep: 25 },
  { id: 8, name: "J4", team: TEAM_BOOTH, hcpHighlands: 12, hcpKeep: 12 },
  { id: 9, name: "Fish", team: TEAM_FISH, hcpHighlands: 4, hcpKeep: 4 },
  { id: 10, name: "Danny", team: TEAM_FISH, hcpHighlands: 9, hcpKeep: 9 },
  { id: 11, name: "Rames", team: TEAM_FISH, hcpHighlands: 11, hcpKeep: 11 },
  { id: 12, name: "Bearman", team: TEAM_FISH, hcpHighlands: 12, hcpKeep: 12 },
  { id: 13, name: "Littel", team: TEAM_FISH, hcpHighlands: 19, hcpKeep: 19 },
  { id: 14, name: "Larson", team: TEAM_FISH, hcpHighlands: 11, hcpKeep: 11 },
  { id: 15, name: "Doug", team: TEAM_FISH, hcpHighlands: 29, hcpKeep: 29 },
  { id: 16, name: "Meyer", team: TEAM_FISH, hcpHighlands: 26, hcpKeep: 26 },
];

// Not in the 16 - available if someone can't play
const alternates = [{ id: 99, name: "Aaron Jackson (17th man)" }];

// Generic stroke index 1-18 (placeholder until real hole-by-hole stroke index is loaded)
const strokeIndex = Array.from({ length: 18 }, (_, i) => i + 1);

function courseHcp(player, course) {
  return course === "Highlands" ? player.hcpHighlands : player.hcpKeep;
}

function strokesReceived(player, course, holeIdx) {
  const hcp = courseHcp(player, course);
  const si = strokeIndex[holeIdx];
  const base = Math.floor(hcp / 18);
  const extra = si <= hcp % 18 ? 1 : 0;
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

// pairings shape: { boothGroups: { playerId: matchNumber|null }, fishGroups: { playerId: matchNumber|null } }
function emptyPairings(players) {
  const boothGroups = {};
  const fishGroups = {};
  players.forEach((p) => {
    if (p.team === TEAM_BOOTH) boothGroups[p.id] = null;
    else fishGroups[p.id] = null;
  });
  return { boothGroups, fishGroups };
}

function buildMatchesFromPairings(pairings, players, format) {
  if (!pairings) return [];
  const size = matchSize(format);
  const numMatches = players.length / 2 / size;
  const matches = [];
  for (let n = 1; n <= numMatches; n++) {
    const side1 = players.filter(
      (p) => p.team === TEAM_BOOTH && pairings.boothGroups[p.id] === n
    );
    const side2 = players.filter(
      (p) => p.team === TEAM_FISH && pairings.fishGroups[p.id] === n
    );
    if (side1.length === size && side2.length === size) {
      matches.push({ id: `m-${n}`, matchNumber: n, side1, side2 });
    }
  }
  return matches;
}

function pairingsComplete(pairings, players, format) {
  const size = matchSize(format);
  const numMatches = players.length / 2 / size;
  return buildMatchesFromPairings(pairings, players, format).length === numMatches;
}

function netBestBallScore(players, course, scores, holeIdx) {
  const nets = players.map((p) => {
    const gross = scores?.[holeIdx]?.[p.id];
    if (gross == null) return null;
    return gross - strokesReceived(p, course, holeIdx);
  });
  if (nets.some((n) => n == null)) return null;
  return Math.min(...nets);
}

function netSinglesScore(player, course, scores, holeIdx) {
  const gross = scores?.[holeIdx]?.[player.id];
  if (gross == null) return null;
  return gross - strokesReceived(player, course, holeIdx);
}

function matchPlayState(match, round, scores) {
  const { format, holes, course } = round;
  let diff = 0;
  let holesPlayed = 0;
  let decided = false;
  let decidedAt = null;

  for (let h = 0; h < holes; h++) {
    let s1, s2;
    if (format === "bestball") {
      s1 = netBestBallScore(match.side1, course, scores, h);
      s2 = netBestBallScore(match.side2, course, scores, h);
    } else {
      s1 = netSinglesScore(match.side1[0], course, scores, h);
      s2 = netSinglesScore(match.side2[0], course, scores, h);
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
  };
}

// ---------- Shared storage helpers (Supabase-backed) ----------
// Uses a single key/value table `tournament_kv` with columns: key (text, primary key), value (jsonb).
// See README.md for the one-time SQL setup.
function scoresKey(roundId) {
  return `${TOURNAMENT_ID}:scores:round-${roundId}`;
}
function pairingsKey(roundId) {
  return `${TOURNAMENT_ID}:pairings:round-${roundId}`;
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
  } catch (e) {
    console.error("Failed to save", key, e);
  }
}

// ---------- UI bits ----------
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
    defaultRounds.forEach((r) => (init[r.id] = emptyPairings(players)));
    return init;
  });
  const [loaded, setLoaded] = useState(false);
  const [syncing, setSyncing] = useState(false);

  const matchesByRound = useMemo(() => {
    const m = {};
    rounds.forEach((r) => {
      m[r.id] = buildMatchesFromPairings(pairingsByRound[r.id], players, r.format);
    });
    return m;
  }, [rounds, pairingsByRound, players]);

  // initial load
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const nextScores = {};
      const nextPairings = {};
      for (const r of rounds) {
        nextScores[r.id] = await loadJSON(scoresKey(r.id), emptyScores(r.holes));
        nextPairings[r.id] = await loadJSON(pairingsKey(r.id), emptyPairings(players));
      }
      if (!cancelled) {
        setScoresByRound(nextScores);
        setPairingsByRound(nextPairings);
        setLoaded(true);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // poll
  useEffect(() => {
    if (!loaded) return;
    const interval = setInterval(async () => {
      setSyncing(true);
      const nextScores = {};
      const nextPairings = {};
      for (const r of rounds) {
        nextScores[r.id] = await loadJSON(scoresKey(r.id), emptyScores(r.holes));
        nextPairings[r.id] = await loadJSON(pairingsKey(r.id), emptyPairings(players));
      }
      setScoresByRound(nextScores);
      setPairingsByRound(nextPairings);
      setSyncing(false);
    }, POLL_MS);
    return () => clearInterval(interval);
  }, [loaded, rounds, players]);

  const totalPoints = useMemo(() => {
    let a = 0,
      b = 0,
      possible = 0;
    rounds.forEach((r) => {
      const matches = matchesByRound[r.id];
      const scores = scoresByRound[r.id] || emptyScores(r.holes);
      matches.forEach((match) => {
        possible += 1;
        const state = matchPlayState(match, r, scores);
        a += state.points1;
        b += state.points2;
      });
    });
    return { a, b, possible };
  }, [rounds, matchesByRound, scoresByRound]);

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

  function updatePairing(roundId, team, playerId, matchNumber) {
    setPairingsByRound((prev) => {
      const next = { ...prev };
      const groupsKey = team === TEAM_BOOTH ? "boothGroups" : "fishGroups";
      const updated = {
        ...next[roundId],
        [groupsKey]: { ...next[roundId][groupsKey], [playerId]: matchNumber },
      };
      next[roundId] = updated;
      saveJSON(pairingsKey(roundId), updated);
      return next;
    });
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

      <div style={{ maxWidth: 980, margin: "0 auto 24px", display: "flex", gap: 8 }}>
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

      <div style={{ maxWidth: 980, margin: "0 auto" }}>
        {tab === "leaderboard" && (
          <Leaderboard rounds={rounds} matchesByRound={matchesByRound} scoresByRound={scoresByRound} />
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
            updatePairing={updatePairing}
            matches={matches}
          />
        )}

        {tab === "setup" && <Setup players={players} rounds={rounds} setRounds={setRounds} alternates={alternates} />}
      </div>
    </div>
  );
}

function Scoreline({ totalPoints, winNeeded }) {
  return (
    <div style={{ display: "flex", gap: 22, alignItems: "baseline" }}>
      <TeamScore label="Booth" value={totalPoints.a} color={COLORS.fairway} />
      <div style={{ fontFamily: MONO, fontSize: 13, color: COLORS.tan }}>
        first to {winNeeded}
      </div>
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

function Leaderboard({ rounds, matchesByRound, scoresByRound }) {
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
                  const state = matchPlayState(m, r, scores);
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
                        {state.label}
                        {state.holesPlayed > 0 && ` · thru ${state.holesPlayed}`}
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

function ScoreEntry({ rounds, activeRound, setActiveRound, round, matches, scores, updateScore, myMatchId, setMyMatchId }) {
  const [holeIdx, setHoleIdx] = useState(0);
  const myMatch = matches.find((m) => m.id === myMatchId);

  return (
    <div>
      <div style={{ display: "flex", gap: 8, marginBottom: 18 }}>
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
        <MatchPicker round={round} matches={matches} scores={scores} onPick={setMyMatchId} />
      ) : (
        <div>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
            <SectionLabel>
              {round.label} ({round.course}) — Hole {holeIdx + 1} of {round.holes}
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
            <div style={{ display: "flex", gap: 24 }}>
              <MatchSidePlayers players={myMatch.side1} holeIdx={holeIdx} scores={scores} round={round} updateScore={updateScore} />
              <div style={{ width: 1, background: COLORS.line, alignSelf: "stretch" }} />
              <MatchSidePlayers players={myMatch.side2} holeIdx={holeIdx} scores={scores} round={round} updateScore={updateScore} />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function MatchPicker({ round, matches, scores, onPick }) {
  return (
    <div>
      <SectionLabel>Which match are you scoring? — {round.label}</SectionLabel>
      <div style={{ display: "grid", gap: 10 }}>
        {matches.map((m) => {
          const state = matchPlayState(m, round, scores);
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
                {state.holesPlayed > 0 ? `thru ${state.holesPlayed}` : "not started"}
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

function MatchSidePlayers({ players, holeIdx, scores, round, updateScore }) {
  return (
    <div style={{ flex: 1, display: "grid", gap: 8 }}>
      {players.map((p) => {
        const strokes = strokesReceived(p, round.course, holeIdx);
        const gross = scores?.[holeIdx]?.[p.id];
        return (
          <div key={p.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10 }}>
            <div>
              <div style={{ fontWeight: 600 }}>{p.name}</div>
              <div style={{ fontFamily: MONO, fontSize: 11, color: "#8a8470" }}>
                {round.course} hcp {courseHcp(p, round.course)}
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

function Pairings({ rounds, activeRound, setActiveRound, round, players, pairings, updatePairing, matches }) {
  const size = matchSize(round.format);
  const numMatches = players.length / 2 / size;
  const boothPlayers = players.filter((p) => p.team === TEAM_BOOTH);
  const fishPlayers = players.filter((p) => p.team === TEAM_FISH);
  const complete = pairingsComplete(pairings, players, round.format);

  return (
    <div>
      <div style={{ display: "flex", gap: 8, marginBottom: 18 }}>
        {rounds.map((r, i) => (
          <TabButton key={r.id} active={i === activeRound} onClick={() => setActiveRound(i)}>
            {r.label}
          </TabButton>
        ))}
      </div>

      <SectionLabel>
        {round.label} — {round.format === "bestball" ? "two-man teams" : "singles"} ({round.course}) ·{" "}
        {complete ? `${matches.length} matches set` : "incomplete"}
      </SectionLabel>

      <div style={{ fontFamily: MONO, fontSize: 12, color: "#8a8470", marginBottom: 16 }}>
        Captain: assign each player a match number. Match 1 plays match 1, etc. — players with the
        same number on each team face off.
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20 }}>
        <PairingColumn
          teamLabel="Booth"
          color={COLORS.fairway}
          teamPlayers={boothPlayers}
          assignments={pairings.boothGroups}
          numMatches={numMatches}
          onChange={(playerId, val) => updatePairing(round.id, TEAM_BOOTH, playerId, val)}
        />
        <PairingColumn
          teamLabel="Fish"
          color={COLORS.flag}
          teamPlayers={fishPlayers}
          assignments={pairings.fishGroups}
          numMatches={numMatches}
          onChange={(playerId, val) => updatePairing(round.id, TEAM_FISH, playerId, val)}
        />
      </div>
    </div>
  );
}

function PairingColumn({ teamLabel, color, teamPlayers, assignments, numMatches, onChange }) {
  return (
    <div>
      <div style={{ fontFamily: MONO, fontSize: 12, letterSpacing: "0.1em", marginBottom: 8, color }}>
        TEAM {teamLabel.toUpperCase()}
      </div>
      <div style={{ display: "grid", gap: 6 }}>
        {teamPlayers.map((p) => (
          <div
            key={p.id}
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              background: "#fff",
              border: `1px solid ${COLORS.line}`,
              borderRadius: 3,
              padding: "8px 10px",
            }}
          >
            <span style={{ fontFamily: SERIF, fontSize: 14 }}>{p.name}</span>
            <select
              value={assignments[p.id] ?? ""}
              onChange={(e) => onChange(p.id, e.target.value === "" ? null : parseInt(e.target.value, 10))}
              style={{
                fontFamily: MONO,
                fontSize: 13,
                padding: "5px 8px",
                border: `1px solid ${COLORS.line}`,
                borderRadius: 3,
              }}
            >
              <option value="">—</option>
              {Array.from({ length: numMatches }, (_, i) => i + 1).map((n) => (
                <option key={n} value={n}>
                  Match {n}
                </option>
              ))}
            </select>
          </div>
        ))}
      </div>
    </div>
  );
}

function Setup({ players, rounds, setRounds, alternates }) {
  function updateRoundField(roundId, field, value) {
    setRounds((prev) => prev.map((r) => (r.id === roundId ? { ...r, [field]: value } : r)));
  }

  const boothPlayers = players.filter((p) => p.team === TEAM_BOOTH);
  const fishPlayers = players.filter((p) => p.team === TEAM_FISH);
  const totalHoles = rounds.reduce((s, r) => s + r.holes, 0);

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
                <option value="Highlands">Highlands</option>
                <option value="Keep">The Keep</option>
              </select>
            </div>
          ))}
        </div>
        <div style={{ fontFamily: MONO, fontSize: 12, color: "#8a8470", marginTop: 10 }}>
          Each round uses the course handicap for whichever course is selected. Pairings are set
          separately in the Pairings tab once captains decide the night before.
        </div>
      </div>

      <div>
        <SectionLabel>Roster & Course Handicaps</SectionLabel>
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
                    <span style={{ color: "#8a8470" }}>
                      H {p.hcpHighlands} · K {p.hcpKeep}
                    </span>
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
