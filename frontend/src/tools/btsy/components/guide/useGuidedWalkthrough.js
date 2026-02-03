import { useEffect, useMemo, useRef, useState } from 'react';
import { BTSY_GUIDE_EVENT } from '../../guides/guideEvents';

function isTruthy(v) {
  return !!v;
}

function isStepSatisfied(step, ctx) {
  if (!step?.action) return false;
  if (step.action.type === 'STATE') {
    const v = ctx?.[step.action.key];
    if (step.action.op === 'truthy') return isTruthy(v);
    return false;
  }
  return false;
}

export function useGuidedWalkthrough({ guide, getContext }) {
  const [active, setActive] = useState(false);
  const [index, setIndex] = useState(0);
  const [lastEvent, setLastEvent] = useState(null);
  const clickArmedRef = useRef(false);

  const steps = guide?.steps || [];

  const ctx = getContext ? getContext() : {};

  const currentStep = useMemo(() => {
    if (!active) return null;
    return steps[index] || null;
  }, [active, steps, index]);

  const start = () => {
    const first = steps.findIndex((s) => !isStepSatisfied(s, ctx));
    setIndex(first >= 0 ? first : 0);
    setLastEvent(null);
    setActive(true);
  };

  const stop = () => {
    setActive(false);
    setLastEvent(null);
  };

  const next = () => {
    setIndex((i) => Math.min(steps.length - 1, i + 1));
  };

  const prev = () => {
    setIndex((i) => Math.max(0, i - 1));
  };

  useEffect(() => {
    if (!active) return;
    if (!currentStep) return;
    if (isStepSatisfied(currentStep, ctx)) {
      if (index < steps.length - 1) setIndex(index + 1);
      else setActive(false);
    }
  }, [active, currentStep, ctx, index, steps.length]);

  useEffect(() => {
    if (!active) return;
    const handler = (e) => {
      const detail = e?.detail || null;
      if (!detail?.name) return;
      setLastEvent(detail);
      const s = currentStep;
      if (!s) return;
      if (s.action?.type === 'EVENT' && s.action?.name === detail.name) {
        if (index < steps.length - 1) setIndex(index + 1);
        else setActive(false);
      }
    };
    window.addEventListener(BTSY_GUIDE_EVENT, handler);
    return () => window.removeEventListener(BTSY_GUIDE_EVENT, handler);
  }, [active, currentStep, index, steps.length]);

  useEffect(() => {
    if (!active) return;
    const onDocClick = (e) => {
      const s = currentStep;
      if (!s) return;
      if (s.action?.type !== 'CLICK') return;
      if (!clickArmedRef.current) return;
      const el = document.querySelector(s.target);
      if (!el) return;
      if (!el.contains(e.target)) return;
      if (index < steps.length - 1) setIndex(index + 1);
      else setActive(false);
    };
    document.addEventListener('click', onDocClick, true);
    return () => document.removeEventListener('click', onDocClick, true);
  }, [active, currentStep, index, steps.length]);

  useEffect(() => {
    if (!active) return;
    const s = currentStep;
    clickArmedRef.current = s?.action?.type === 'CLICK';
  }, [active, currentStep]);

  return {
    active,
    start,
    stop,
    next,
    prev,
    currentStep,
    stepIndex: index,
    stepsCount: steps.length,
    lastEvent
  };
}

