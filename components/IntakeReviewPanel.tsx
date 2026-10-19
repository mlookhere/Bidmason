"use client";

import { useState } from "react";
import { changeReviewSelection, emptyReviewSelection,
  prepareReviewPreviewRequest, type ReviewWorkbenchSelection }
  from "../lib/intake-review-selection.ts";
import type { ReviewWorkbenchModel } from "../lib/intake-review-workbench.ts";

type PreviewRequest = ReturnType<typeof prepareReviewPreviewRequest>;

/**
 * Internal presentation only: no fetch, no credentials, no persistence,
 * approval, publication or customer communications. A trusted caller must
 * reauthorize and recompute any preview request using persisted originals.
 */
export function IntakeReviewPanel({
  model, onRequestPreview,
}: {
  model: ReviewWorkbenchModel;
  onRequestPreview?: (request: PreviewRequest) => void;
}) {
  const [stored, setStored] = useState<ReviewWorkbenchSelection>(
    () => emptyReviewSelection(model.key));
  const [error, setError] = useState<string | null>(null);
  const current = stored.key === model.key
    ? stored : emptyReviewSelection(model.key);
  const [requestedKey, setRequestedKey] = useState<string | null>(null);

  const change = (
    action: Parameters<typeof changeReviewSelection>[2],
  ) => {
    try {
      setStored(previous => changeReviewSelection(model, previous, action));
      setError(null);
      setRequestedKey(null);
    } catch {
      setError("This selection is no longer available. Refresh the review.");
    }
  };

  const submit = () => {
    if (!onRequestPreview) return;
    try {
      const request = prepareReviewPreviewRequest(model, current);
      onRequestPreview(request);
      setRequestedKey(model.key);
      setError(null);
    } catch {
      setError("Select valid services and acknowledge each optional add-on.");
      setRequestedKey(null);
    }
  };

  return (
    <section aria-label="Internal extraction review">
      <h2>Review extracted services</h2>
      <p role="status">Internal review only. Suggested items are not approved pricing.
        No quote is sent or published here.</p>
      <p>Policy: {model.policyId}, revision {model.policyRevision}</p>
      <fieldset>
        <legend>Select supported services to include in a preview</legend>
        {model.rows.map(row => {
          const allowed = row.status === "available" || row.status === "optional";
          const checked = current.selectedIndices.includes(row.index);
          return (
            <div key={row.index}>
              <label>
                <input type="checkbox" checked={checked} disabled={!allowed}
                  onChange={event => change({type:"select",index:row.index,
                    checked:event.target.checked})}/>
                {row.label} — {row.units} unit(s)
              </label>
              <p>Source: <q>{row.excerpt}</q></p>
              <p>Status: {row.status}. {row.explanation}</p>
              {row.status === "optional" && checked && (
                <label>
                  <input type="checkbox"
                    checked={current.acceptedAddonCodes.includes(row.serviceCode)}
                    onChange={event => change({
                      type:"acknowledge-addon",serviceCode:row.serviceCode,
                      checked:event.target.checked,
                    })}/>
                  I separately acknowledge the optional {row.label} service
                </label>
              )}
            </div>
          );
        })}
      </fieldset>
      <button type="button" onClick={submit}
        disabled={!onRequestPreview || current.selectedIndices.length === 0}>
        Request internal pricing preview
      </button>
      <button type="button" onClick={() => change({type:"reset"})}>
        Clear selections
      </button>
      {!onRequestPreview && <p>Preview integration is not enabled.</p>}
      {error && <p role="alert">{error}</p>}
      {requestedKey === model.key && <p role="status">
        Preview request prepared for authorized recalculation. Nothing was sent.
      </p>}
    </section>
  );
}
