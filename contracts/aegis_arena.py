# { "Depends": "py-genlayer:1jb45aa8ynh2a9c9xn3b7qqh8sm5q93hwfp7jqmwsfhh8jpz09h6" }

from dataclasses import dataclass

from genlayer import *

# ---------------------------------------------------------------------------
# Bounds and error tags
# ---------------------------------------------------------------------------
ERROR_EXPECTED = "[EXPECTED]"

STATUS_OPEN = "OPEN"
STATUS_SETTLED = "SETTLED"
STATUS_CANCELLED = "CANCELLED"
VALID_STATUSES = (STATUS_OPEN, STATUS_SETTLED, STATUS_CANCELLED)

VALID_STANCES = ("COMMEND", "CHALLENGE", "ANALYSIS")

# Deterministic score is 0..40, AI verdict is 0..60, total is 0..100.
DET_MAX = 40
AI_MAX = 60
TOTAL_MAX = 100

WEB_TRUNCATE = 5000
RATIONALE_MAX = 400


# ---------------------------------------------------------------------------
# Persistent structures
# ---------------------------------------------------------------------------
@allow_storage
@dataclass
class Tournament:
    tournament_id: u256
    creator: Address
    title: str
    challenge_brief: str
    reference_url: str
    mandatory_fact_token: str
    prize_pool_points: u256
    entry_count: u256
    best_score: u256
    current_leader: Address
    status: str
    winner: Address


@allow_storage
@dataclass
class BattleSubmission:
    submission_id: u256
    tournament_id: u256
    player: Address
    moniker: str
    tactic_payload: str
    deterministic_score: u256
    ai_verdict_score: u256
    total_score: u256
    endorsements: u256
    evaluated: bool
    judge_rationale: str


@allow_storage
@dataclass
class ArenaComment:
    comment_id: u256
    tournament_id: u256
    submission_id: u256
    author: Address
    author_moniker: str
    message: str
    stance: str


# ---------------------------------------------------------------------------
# Pure helpers (no storage access, safe inside non-deterministic blocks)
# ---------------------------------------------------------------------------
def _require(cond: bool, message: str) -> None:
    if not cond:
        raise gl.vm.UserError(f"{ERROR_EXPECTED} {message}")


def _is_clean_str(value: str) -> bool:
    for ch in value:
        code = ord(ch)
        if code < 32 or code == 127:
            return False
    return True


def _clamp(value: int, low: int, high: int) -> int:
    if value < low:
        return low
    if value > high:
        return high
    return value


def _strip_control(raw: str) -> str:
    out = []
    for ch in raw:
        code = ord(ch)
        if code in (9, 10, 13):
            out.append(ch)
        elif code < 32 or code == 127:
            out.append(" ")
        else:
            out.append(ch)
    return "".join(out)


def _defuse_delimiters(text: str) -> str:
    # Neutralize attempts by untrusted content to break out of the prompt
    # wrapper tags we place around it.
    lowered = text.lower()
    needles = ("</untrusted", "<untrusted", "</system", "<system", "<|", "|>")
    result = text
    for needle in needles:
        start = lowered.find(needle)
        while start != -1:
            result = (
                result[:start]
                + "[defused]"
                + result[start + len(needle):]
            )
            lowered = result.lower()
            start = lowered.find(needle)
    return result


def _normalize_token(token: str) -> str:
    return token.lower().strip()


def _count_occurrences(haystack: str, needle: str) -> int:
    if not needle:
        return 0
    count = 0
    start = haystack.find(needle)
    while start != -1:
        count += 1
        start = haystack.find(needle, start + len(needle))
    return count


def _compute_deterministic_score(payload: str, token: str) -> int:
    # Component 1: mandatory token emphasis (6..10).
    text = payload.strip()
    lowered = text.lower()
    norm_token = _normalize_token(token)
    occ = _count_occurrences(lowered, norm_token)
    comp_token = 6 + _clamp(occ - 1, 0, 4) if occ >= 1 else 0

    # Component 2: length efficiency (0..15), peak between 400 and 900 chars.
    length = len(text)
    if length <= 400:
        comp_length = length * 15 // 400
    elif length <= 900:
        comp_length = 15
    else:
        comp_length = max(0, 15 - (length - 900) * 15 // 600)

    # Component 3: structural richness (0..15).
    sentences = text.count(".") + text.count("!") + text.count("?")
    words = text.split()
    unique_words = len({w.lower().strip(".,;:()!?\"'") for w in words})
    markers = 0
    for marker in ("\n", "-", "*", ":", ";"):
        if marker in text:
            markers += 1
    comp_structure = _clamp(sentences * 2 + markers * 2 + (3 if unique_words >= 24 else 0), 0, 15)

    return _clamp(comp_token + comp_length + comp_structure, 0, DET_MAX)


def _parse_llm_score(raw: dict) -> tuple:
    if not isinstance(raw, dict):
        raise gl.vm.UserError(f"{ERROR_EXPECTED} judge returned non-dict")

    score_val = None
    for key in ("ai_verdict_score", "score", "rating", "total"):
        if key in raw:
            score_val = raw[key]
            break
    if score_val is None:
        raise gl.vm.UserError(f"{ERROR_EXPECTED} judge response missing score")

    try:
        score = int(round(float(str(score_val).strip())))
    except (ValueError, TypeError):
        raise gl.vm.UserError(f"{ERROR_EXPECTED} judge score not numeric")

    score = _clamp(score, 0, AI_MAX)

    rationale_val = raw.get("rationale", raw.get("reasoning", ""))
    rationale = str(rationale_val).strip()
    if len(rationale) > RATIONALE_MAX:
        rationale = rationale[:RATIONALE_MAX]
    return (u256(score), rationale)


class AegisArena(gl.Contract):
    # ---- storage fields ----
    owner: Address
    tournament_counter: u256
    submission_counter: u256
    comment_counter: u256

    tournaments: TreeMap[str, Tournament]
    tournament_ids: DynArray[str]
    submissions: TreeMap[str, BattleSubmission]
    comments: TreeMap[str, ArenaComment]

    player_points: TreeMap[str, u256]
    player_wins: TreeMap[str, u256]
    player_badges: TreeMap[str, str]
    player_registry: DynArray[str]
    has_endorsed: TreeMap[str, bool]

    stat_open: u256
    stat_settled: u256
    stat_cancelled: u256
    evaluated_count: u256
    total_endorsements: u256

    def __init__(self):
        self.owner = gl.message.sender_address
        self.tournament_counter = 0
        self.submission_counter = 0
        self.comment_counter = 0
        self.stat_open = 0
        self.stat_settled = 0
        self.stat_cancelled = 0
        self.evaluated_count = 0
        self.total_endorsements = 0

    # ---- internal helpers (storage aware) ----
    def _register_player(self, addr: Address) -> str:
        key = addr.as_hex
        if key not in self.player_points:
            self.player_points[key] = 0
        if key not in self.player_wins:
            self.player_wins[key] = 0
        if key not in self.player_badges:
            self.player_badges[key] = ""
        exists = False
        idx = 0
        n = len(self.player_registry)
        while idx < n:
            if self.player_registry[idx] == key:
                exists = True
            idx += 1
        if not exists:
            self.player_registry.append(key)
        return key

    def _add_points(self, addr: Address, amount: u256) -> None:
        key = self._register_player(addr)
        self.player_points[key] = self.player_points[key] + amount

    def _update_leader(self, t: Tournament, candidate_total: u256, candidate_player: Address) -> None:
        if candidate_total > t.best_score:
            t.best_score = candidate_total
            t.current_leader = candidate_player

    # ---- write methods ----
    @gl.public.write
    def create_tournament(
        self,
        title: str,
        challenge_brief: str,
        reference_url: str,
        mandatory_fact_token: str,
        prize_pool_points: u256,
    ) -> u256:
        _require(1 <= len(title) <= 100, "title must be 1..100 chars")
        _require(_is_clean_str(title), "title contains control characters")
        _require(1 <= len(challenge_brief) <= 1000, "challenge_brief must be 1..1000 chars")
        _require(_is_clean_str(challenge_brief), "challenge_brief contains control characters")
        _require(8 <= len(reference_url) <= 512, "reference_url must be 8..512 chars")
        _require(
            reference_url.startswith("http://") or reference_url.startswith("https://"),
            "reference_url must start with http:// or https://",
        )
        _require(_is_clean_str(reference_url), "reference_url must not contain whitespace or control chars")
        for ch in reference_url:
            _require(ch != " ", "reference_url must not contain spaces")
        _require(1 <= len(mandatory_fact_token) <= 64, "mandatory_fact_token must be 1..64 chars")
        _require(_is_clean_str(mandatory_fact_token), "mandatory_fact_token contains control chars")
        _require(100 <= prize_pool_points <= 1000000, "prize_pool_points must be 100..1000000")

        tid = self.tournament_counter + 1
        self.tournament_counter = tid
        sender = gl.message.sender_address

        tournament = Tournament(
            tournament_id=u256(tid),
            creator=sender,
            title=title,
            challenge_brief=challenge_brief,
            reference_url=reference_url,
            mandatory_fact_token=mandatory_fact_token,
            prize_pool_points=u256(prize_pool_points),
            entry_count=0,
            best_score=0,
            current_leader=Address(bytes(20)),
            status=STATUS_OPEN,
            winner=Address(bytes(20)),
        )
        self.tournaments[str(tid)] = tournament
        self.tournament_ids.append(str(tid))
        self._register_player(sender)
        self.stat_open = self.stat_open + 1
        return u256(tid)

    @gl.public.write
    def submit_tactic(self, tournament_id: u256, moniker: str, tactic_payload: str) -> u256:
        tkey = str(tournament_id)
        _require(tkey in self.tournaments, "tournament does not exist")
        tournament = self.tournaments[tkey]
        _require(tournament.status == STATUS_OPEN, "tournament is not OPEN")
        _require(1 <= len(moniker) <= 32, "moniker must be 1..32 chars")
        _require(_is_clean_str(moniker), "moniker contains control characters")
        _require(10 <= len(tactic_payload) <= 1500, "tactic_payload must be 10..1500 chars")
        _require(_is_clean_str(tactic_payload), "tactic_payload contains control characters")

        norm_token = _normalize_token(tournament.mandatory_fact_token)
        _require(
            norm_token in tactic_payload.lower(),
            "tactic_payload must include the mandatory fact token",
        )

        sid = self.submission_counter + 1
        self.submission_counter = sid
        sender = gl.message.sender_address

        det = _compute_deterministic_score(tactic_payload, tournament.mandatory_fact_token)

        submission = BattleSubmission(
            submission_id=u256(sid),
            tournament_id=u256(tournament_id),
            player=sender,
            moniker=moniker,
            tactic_payload=tactic_payload,
            deterministic_score=u256(det),
            ai_verdict_score=0,
            total_score=u256(det),
            endorsements=0,
            evaluated=False,
            judge_rationale="",
        )
        self.submissions[str(sid)] = submission
        tournament.entry_count = tournament.entry_count + 1
        self._update_leader(tournament, u256(det), sender)
        self.tournaments[tkey] = tournament

        participation_xp = u256(5 + det // 4)
        self._add_points(sender, participation_xp)
        return u256(sid)

    @gl.public.write
    def evaluate_tactic_live(self, submission_id: u256) -> u256:
        skey = str(submission_id)
        _require(skey in self.submissions, "submission does not exist")
        submission = self.submissions[skey]
        _require(not submission.evaluated, "submission already evaluated")

        tkey = str(submission.tournament_id)
        _require(tkey in self.tournaments, "tournament does not exist")
        tournament = self.tournaments[tkey]
        _require(tournament.status == STATUS_OPEN, "tournament is not OPEN")

        # Snapshot every storage value needed by the non-deterministic block.
        challenge_brief = tournament.challenge_brief
        reference_url = tournament.reference_url
        mandatory_fact_token = tournament.mandatory_fact_token
        tactic_payload = submission.tactic_payload
        deterministic_score = submission.deterministic_score

        def judge_fn():
            page = gl.nondet.web.render(reference_url, mode="text")
            page = _defuse_delimiters(_strip_control(page))
            if len(page) > WEB_TRUNCATE:
                page = page[:WEB_TRUNCATE]

            safe_payload = _defuse_delimiters(_strip_control(tactic_payload))
            safe_brief = _defuse_delimiters(_strip_control(challenge_brief))
            safe_token = _defuse_delimiters(_strip_control(mandatory_fact_token))

            task = (
                "You are a strict tactical judge for an on-chain arena battle. "
                "Score the submission from 0 to 60 based ONLY on factual alignment "
                "with the reference source and tactical quality. "
                f"The submission must correctly weave in the mandatory fact token: '{safe_token}'. "
                "Return JSON: {\"ai_verdict_score\": <integer 0..60>, \"rationale\": \"<short explanation>\"}.\n\n"
                f"<challenge_brief>{safe_brief}</challenge_brief>\n\n"
                f"<untrusted_reference>\n{page}\n</untrusted_reference>\n\n"
                f"<untrusted_submission>\n{safe_payload}\n</untrusted_submission>"
            )
            verdict = gl.nondet.exec_prompt(
                task,
                system="Return only a JSON object with ai_verdict_score and rationale. No prose.",
                response_format="json",
            )
            score, rationale = _parse_llm_score(verdict)
            return {"ai_verdict_score": score, "rationale": rationale}

        result = gl.eq_principle.prompt_comparative(
            judge_fn,
            principle=(
                "ai_verdict_score must be within 10 points of each other and both "
                "judged the same submission against the same reference; rationale may differ."
            ),
        )

        ai_score = u256(_clamp(int(result["ai_verdict_score"]), 0, AI_MAX))
        rationale = str(result["rationale"])
        if len(rationale) > RATIONALE_MAX:
            rationale = rationale[:RATIONALE_MAX]

        total = u256(_clamp(int(deterministic_score) + int(ai_score), 0, TOTAL_MAX))
        submission.ai_verdict_score = ai_score
        submission.total_score = total
        submission.evaluated = True
        submission.judge_rationale = rationale
        self.submissions[skey] = submission

        self._update_leader(tournament, total, submission.player)
        self.tournaments[tkey] = tournament
        self.evaluated_count = self.evaluated_count + 1
        self._add_points(submission.player, ai_score)
        return total

    @gl.public.write
    def score_tactic_deterministic(self, submission_id: u256, rubric_bonus: u256, rationale: str) -> u256:
        skey = str(submission_id)
        _require(skey in self.submissions, "submission does not exist")
        submission = self.submissions[skey]
        _require(not submission.evaluated, "submission already evaluated")

        tkey = str(submission.tournament_id)
        _require(tkey in self.tournaments, "tournament does not exist")
        tournament = self.tournaments[tkey]
        _require(tournament.status == STATUS_OPEN, "tournament is not OPEN")
        sender = gl.message.sender_address
        _require(
            sender == tournament.creator or sender == self.owner,
            "only tournament creator or owner may score deterministically",
        )
        _require(int(rubric_bonus) <= AI_MAX, "rubric_bonus must be 0..60")
        _require(1 <= len(rationale) <= RATIONALE_MAX, "rationale must be 1..400 chars")
        _require(_is_clean_str(rationale), "rationale contains control characters")

        bonus = u256(rubric_bonus)
        total = u256(_clamp(int(submission.deterministic_score) + int(bonus), 0, TOTAL_MAX))
        submission.ai_verdict_score = bonus
        submission.total_score = total
        submission.evaluated = True
        submission.judge_rationale = rationale
        self.submissions[skey] = submission

        self._update_leader(tournament, total, submission.player)
        self.tournaments[tkey] = tournament
        self.evaluated_count = self.evaluated_count + 1
        self._add_points(submission.player, bonus)
        return total

    @gl.public.write
    def endorse_submission(self, submission_id: u256) -> u256:
        skey = str(submission_id)
        _require(skey in self.submissions, "submission does not exist")
        submission = self.submissions[skey]
        sender = gl.message.sender_address
        _require(sender != submission.player, "cannot endorse your own submission")

        endorse_key = f"{submission_id}:{sender.as_hex}"
        _require(endorse_key not in self.has_endorsed, "already endorsed this submission")
        self.has_endorsed[endorse_key] = True

        submission.endorsements = submission.endorsements + 1
        if submission.total_score < TOTAL_MAX:
            headroom = TOTAL_MAX - int(submission.total_score)
            bonus = 2 if headroom >= 2 else headroom
            submission.total_score = u256(int(submission.total_score) + bonus)
        self.submissions[skey] = submission

        self.total_endorsements = self.total_endorsements + 1
        self._add_points(submission.player, 2)
        self._add_points(sender, 1)
        return submission.endorsements

    @gl.public.write
    def post_arena_comment(
        self,
        tournament_id: u256,
        submission_id: u256,
        author_moniker: str,
        message: str,
        stance: str,
    ) -> u256:
        tkey = str(tournament_id)
        _require(tkey in self.tournaments, "tournament does not exist")
        skey = str(submission_id)
        _require(skey in self.submissions, "submission does not exist")
        submission = self.submissions[skey]
        _require(submission.tournament_id == tournament_id, "submission is not part of tournament")

        _require(1 <= len(author_moniker) <= 32, "author_moniker must be 1..32 chars")
        _require(_is_clean_str(author_moniker), "author_moniker contains control characters")
        _require(1 <= len(message) <= 280, "message must be 1..280 chars")
        _require(_is_clean_str(message), "message contains control characters")
        _require(stance in VALID_STANCES, "stance must be COMMEND, CHALLENGE or ANALYSIS")

        cid = self.comment_counter + 1
        self.comment_counter = cid
        sender = gl.message.sender_address

        comment = ArenaComment(
            comment_id=u256(cid),
            tournament_id=u256(tournament_id),
            submission_id=u256(submission_id),
            author=sender,
            author_moniker=author_moniker,
            message=message,
            stance=stance,
        )
        self.comments[str(cid)] = comment
        self._register_player(sender)
        return u256(cid)

    @gl.public.write
    def settle_tournament(self, tournament_id: u256) -> str:
        tkey = str(tournament_id)
        _require(tkey in self.tournaments, "tournament does not exist")
        tournament = self.tournaments[tkey]
        sender = gl.message.sender_address
        _require(
            sender == tournament.creator or sender == self.owner,
            "only tournament creator or owner may settle",
        )
        _require(tournament.status == STATUS_OPEN, "tournament is not OPEN")
        _require(tournament.entry_count > 0, "cannot settle a tournament with no entries")

        tournament.status = STATUS_SETTLED
        winner = tournament.current_leader
        tournament.winner = winner
        self.tournaments[tkey] = tournament

        self._add_points(winner, tournament.prize_pool_points)
        wkey = winner.as_hex
        self._register_player(winner)
        self.player_wins[wkey] = self.player_wins[wkey] + 1
        badge = f"CHAMPION:{tournament_id}"
        existing = self.player_badges[wkey]
        self.player_badges[wkey] = badge if existing == "" else existing + ";" + badge

        self.stat_open = self.stat_open - 1 if self.stat_open > 0 else 0
        self.stat_settled = self.stat_settled + 1
        return winner.as_hex

    @gl.public.write
    def cancel_tournament(self, tournament_id: u256) -> None:
        tkey = str(tournament_id)
        _require(tkey in self.tournaments, "tournament does not exist")
        tournament = self.tournaments[tkey]
        sender = gl.message.sender_address
        _require(
            sender == tournament.creator or sender == self.owner,
            "only tournament creator or owner may cancel",
        )
        _require(tournament.status == STATUS_OPEN, "tournament is not OPEN")
        _require(tournament.entry_count == 0, "cannot cancel a tournament with entries")

        tournament.status = STATUS_CANCELLED
        self.tournaments[tkey] = tournament
        self.stat_open = self.stat_open - 1 if self.stat_open > 0 else 0
        self.stat_cancelled = self.stat_cancelled + 1

    # ---- view methods ----
    @gl.public.view
    def get_tournament(self, tournament_id: u256) -> dict:
        tkey = str(tournament_id)
        if tkey not in self.tournaments:
            return {}
        t = self.tournaments[tkey]
        return {
            "tournament_id": int(t.tournament_id),
            "creator": t.creator.as_hex,
            "title": t.title,
            "challenge_brief": t.challenge_brief,
            "reference_url": t.reference_url,
            "mandatory_fact_token": t.mandatory_fact_token,
            "prize_pool_points": int(t.prize_pool_points),
            "entry_count": int(t.entry_count),
            "best_score": int(t.best_score),
            "current_leader": t.current_leader.as_hex,
            "status": t.status,
            "winner": t.winner.as_hex,
        }

    @gl.public.view
    def get_all_tournaments(self) -> list:
        out = []
        idx = 0
        n = len(self.tournament_ids)
        while idx < n:
            key = self.tournament_ids[idx]
            t = self.tournaments[key]
            out.append(
                {
                    "tournament_id": int(t.tournament_id),
                    "creator": t.creator.as_hex,
                    "title": t.title,
                    "reference_url": t.reference_url,
                    "mandatory_fact_token": t.mandatory_fact_token,
                    "prize_pool_points": int(t.prize_pool_points),
                    "entry_count": int(t.entry_count),
                    "best_score": int(t.best_score),
                    "current_leader": t.current_leader.as_hex,
                    "status": t.status,
                    "winner": t.winner.as_hex,
                }
            )
            idx += 1
        return out

    @gl.public.view
    def get_tournament_submissions(self, tournament_id: u256) -> list:
        collected = []
        sid = 1
        total = int(self.submission_counter)
        while sid <= total:
            submission = self.submissions[str(sid)]
            if submission.tournament_id == tournament_id:
                collected.append(
                    {
                        "submission_id": int(submission.submission_id),
                        "tournament_id": int(submission.tournament_id),
                        "player": submission.player.as_hex,
                        "moniker": submission.moniker,
                        "tactic_payload": submission.tactic_payload,
                        "deterministic_score": int(submission.deterministic_score),
                        "ai_verdict_score": int(submission.ai_verdict_score),
                        "total_score": int(submission.total_score),
                        "endorsements": int(submission.endorsements),
                        "evaluated": bool(submission.evaluated),
                        "judge_rationale": submission.judge_rationale,
                    }
                )
            sid += 1
        collected.sort(key=lambda item: (-item["total_score"], -item["endorsements"], item["submission_id"]))
        return collected

    @gl.public.view
    def get_tournament_comments(self, tournament_id: u256) -> list:
        collected = []
        cid = 1
        total = int(self.comment_counter)
        while cid <= total:
            comment = self.comments[str(cid)]
            if comment.tournament_id == tournament_id:
                collected.append(
                    {
                        "comment_id": int(comment.comment_id),
                        "tournament_id": int(comment.tournament_id),
                        "submission_id": int(comment.submission_id),
                        "author": comment.author.as_hex,
                        "author_moniker": comment.author_moniker,
                        "message": comment.message,
                        "stance": comment.stance,
                    }
                )
            cid += 1
        return collected

    @gl.public.view
    def get_leaderboard(self) -> list:
        rows = []
        idx = 0
        n = len(self.player_registry)
        while idx < n:
            key = self.player_registry[idx]
            rows.append(
                {
                    "address": key,
                    "points": int(self.player_points[key]),
                    "wins": int(self.player_wins[key]),
                }
            )
            idx += 1
        rows.sort(key=lambda item: (-item["points"], -item["wins"], item["address"]))
        return rows

    @gl.public.view
    def get_arena_stats(self) -> dict:
        return {
            "total_tournaments": int(self.tournament_counter),
            "open": int(self.stat_open),
            "settled": int(self.stat_settled),
            "cancelled": int(self.stat_cancelled),
            "total_submissions": int(self.submission_counter),
            "evaluated_submissions": int(self.evaluated_count),
            "total_endorsements": int(self.total_endorsements),
            "total_comments": int(self.comment_counter),
        }
