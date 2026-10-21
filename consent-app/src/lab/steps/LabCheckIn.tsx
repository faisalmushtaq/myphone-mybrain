import { useEffect, useState } from "react";
import { getApi } from "../../api";
import { Button } from "../../components/ui/Button";
import { Callout } from "../../components/ui/Callout";
import { ChoiceField, FieldWrapper } from "../../components/ui/Field";
import { announce } from "../../lib/announce";
import { describeError, labClientInfo, labSession } from "../api";
import { labStudy } from "../config";
import { LabShell } from "../LabShell";
import { ShotPicker } from "../ShotPicker";
import { useLab, useLabGroup } from "../store";
import { useLabSender } from "../useLabSender";
import type { FieldError } from "../validation";

/**
 * The mid-break check-in, once, on day 15 of the break (20 October 2026): a
 * few quick questions and a screenshot of this week's screen time (required),
 * then MyStory (required). The answers are filed under the
 * participant ID; the screenshots go with them, linked to the check-in.
 */
export function LabCheckIn() {
  const { state, dispatch } = useLab();
  const { forms, words } = useLabGroup();
  const labCheckInForm = forms.checkIn;
  const { send, busy: sending } = useLabSender();
  const [errors, setErrors] = useState<FieldError[]>([]);
  const [busy, setBusy] = useState(false);
  const errs = Object.fromEntries(errors.map((e) => [e.field, e.message]));
  const ready = state.codeConfirmed && state.submission.consentStage === "sent";
  const answers = state.checkIn.answers;
  const pending = state.screenshots.filter((s) => s.status !== "sent");
  const answered = Boolean(state.checkIn.checkInId);
  // Screenshots already in for this check-in: sent from this device, or (on another device) counted by the server.
  const shotsIn = Math.max(
    state.screenshots.filter((s) => s.status === "sent").length,
    state.progress?.phases?.mid?.screenshots ?? 0,
  );
  // One check-in each: one already sent (on any device) carries on, with its screenshot and story still to come.
  const earlierId = state.progress?.storyRepeatAllowed
    ? null
    : (state.progress?.checkInId ?? null);
  useEffect(() => {
    if (!state.checkIn.checkInId && earlierId)
      dispatch({
        type: "checkin-sent",
        checkInId: earlierId,
        receivedAt: state.progress?.lastCheckInAt ?? new Date().toISOString(),
        count: 1,
      });
  }, [
    earlierId,
    state.checkIn.checkInId,
    state.progress?.lastCheckInAt,
    dispatch,
  ]);
  const answersHere = Object.values(answers).some((v) => (v ?? "").trim());

  const validate = (): FieldError[] => {
    const found: FieldError[] = [];
    for (const q of labCheckInForm.questions) {
      const value = (answers[q.id] ?? "").trim();
      if (q.required && !value)
        found.push({
          field:
            q.type === "choice"
              ? `lab-q-${q.id}-${q.options[0].value}`
              : `lab-q-${q.id}`,
          message: `Please answer: ${q.text}`,
        });
      if (q.type === "text" && value.length > q.maxLength)
        found.push({
          field: `lab-q-${q.id}`,
          message: `Please keep this under ${q.maxLength} characters.`,
        });
    }
    return found;
  };

  const submit = async () => {
    setErrors([]);
    const found = answered ? [] : validate();
    // The screenshot is required (20 October 2026).
    if (!pending.length && !shotsIn)
      found.push({
        field: "lab-files",
        message:
          "Add a screenshot of your screen time for the past week: the check-in needs one.",
      });
    if (found.length) {
      setErrors(found);
      return;
    }
    setBusy(true);
    try {
      let checkInId = state.checkIn.checkInId;
      if (!checkInId) {
        const session = await labSession(state.session, (s) =>
          dispatch({ type: "session", session: s }),
        );
        const tidy = Object.fromEntries(
          labCheckInForm.questions
            .filter((q) => (answers[q.id] ?? "").trim())
            .map((q) => [q.id, (answers[q.id] ?? "").trim()]),
        );
        const result = await getApi().submitLabCheckIn(session, {
          participantCode: state.code,
          formId: labCheckInForm.id,
          formVersion: labCheckInForm.version,
          answers: tidy,
          client: labClientInfo(),
        });
        dispatch({
          type: "checkin-sent",
          checkInId: result.checkInId,
          receivedAt: result.receivedAt,
          count: result.count,
        });
        checkInId = result.checkInId;
        announce("Check-in sent.");
      }
      if (pending.length) {
        const sent = await send(["screenshot"], { checkInId });
        if (!sent.ok) {
          setErrors([
            {
              field: "lab-files",
              message: `Your answers are in, but the screenshots did not go: ${sent.message ?? "please try again."}`,
            },
          ]);
          return;
        }
      }
      // MyStory follows the check-in (required, 20 October 2026), then the summary; once the break's story is in, straight to the summary
      // (one story a phase, 19 October 2026, apart from the team's test accounts).
      const told =
        (state.progress?.stories?.mid ?? 0) > 0 &&
        state.progress?.storyRepeatAllowed !== true;
      dispatch({ type: "go-to", stepId: told ? "done" : "mystory" });
    } catch (error) {
      setErrors([
        { field: "lab-files", message: describeError(error, "your check-in") },
      ]);
    } finally {
      setBusy(false);
    }
  };

  if (!ready) {
    return (
      <LabShell
        kicker={words.midName}
        title="First, tell us who you are."
        intro={
          <p>
            Your details find your record, so your answers join up with the rest
            of your data.
          </p>
        }
        hideContinue
        hideBack
      >
        <div className="mpmb-actions">
          <Button
            variant="primary"
            arrow
            onClick={() =>
              dispatch({ type: "go-to", stepId: "participant-id" })
            }
          >
            Enter my details
          </Button>
        </div>
      </LabShell>
    );
  }

  return (
    <LabShell
      kicker={words.midName}
      title={words.checkInTitle}
      intro={
        <p>
          A few quick questions about the past week. There are no right answers,
          and nothing here changes your payment or your place in the study.
        </p>
      }
      errors={errors}
      onContinue={() => void submit()}
      continueLabel={
        answered
          ? pending.length
            ? "Send my screenshots"
            : "Continue"
          : "Send my check-in"
      }
      continueLoading={busy || sending}
      width="wide"
    >
      {answered && (
        <Callout tone="success" role="status">
          <p>
            Your answers are in.{" "}
            {pending.length
              ? "Your screenshots still need to go."
              : shotsIn
                ? ""
                : "Add a screenshot of your screen time below to finish."}
          </p>
        </Callout>
      )}
      {(!answered || answersHere) && (
        <section aria-labelledby="checkin-questions" className="mpmb-checkin">
          <h2 className="mpmb-h2" id="checkin-questions">
            1. A few questions
          </h2>
          {labCheckInForm.questions.map((q) =>
            q.type === "choice" ? (
              <ChoiceField
                key={q.id}
                id={`lab-q-${q.id}`}
                name={`lab-q-${q.id}`}
                legend={q.text}
                hint={q.hint}
                value={answers[q.id] ?? null}
                onChange={(v) =>
                  !answered &&
                  dispatch({
                    type: "checkin-answer",
                    questionId: q.id,
                    value: v,
                  })
                }
                options={q.options}
                error={errs[`lab-q-${q.id}-${q.options[0].value}`]}
              />
            ) : (
              <FieldWrapper
                key={q.id}
                id={`lab-q-${q.id}`}
                label={q.text}
                hint={q.hint}
                error={errs[`lab-q-${q.id}`]}
              >
                <textarea
                  id={`lab-q-${q.id}`}
                  className="mpmb-input mpmb-input--area"
                  rows={4}
                  maxLength={q.maxLength}
                  value={answers[q.id] ?? ""}
                  readOnly={answered}
                  onChange={(e) =>
                    dispatch({
                      type: "checkin-answer",
                      questionId: q.id,
                      value: e.target.value,
                    })
                  }
                  aria-describedby={q.hint ? `lab-q-${q.id}-hint` : undefined}
                />
              </FieldWrapper>
            ),
          )}
        </section>
      )}

      <section aria-labelledby="checkin-shots" id="lab-files" tabIndex={-1}>
        <h2 className="mpmb-h2" id="checkin-shots">
          2. This week’s screen time
        </h2>
        <p>
          A screenshot of your Screen Time (iPhone: Settings, Screen Time, See
          All App &amp; Website Activity) or Digital Wellbeing (Android:
          Settings, Digital Wellbeing) for the past week. The weekly chart and
          the list of apps are the most useful.
        </p>
        <ShotPicker busy={busy || sending} onAdded={() => setErrors([])} />
      </section>
      <p className="mpmb-hint">
        Sent to the study’s secure storage at the University of Leeds, labelled
        with your participant ID{" "}
        <strong className="mpmb-mono">{state.code}</strong>. {words.problems}{" "}
        Contact {labStudy.contact.name} at{" "}
        <a href={`mailto:${labStudy.contact.email}`}>
          {labStudy.contact.email}
        </a>
        .
      </p>
    </LabShell>
  );
}
