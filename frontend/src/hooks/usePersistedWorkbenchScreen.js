import { useEffect, useMemo, useState } from 'react';
import { useAppContext } from '../context/AppContext';
import { persistWorkbenchView, readWorkbenchView } from '../utils/navigationPersistence';

const resolveNextValue = (candidate, fallback) => {
  const value = String(candidate || '').trim();
  return value || fallback;
};

const usePersistedWorkbenchScreen = (toolKey, initialScreen) => {
  const { activeEnv, username } = useAppContext();

  const scope = useMemo(
    () => ({
      username,
      envId: activeEnv,
      toolKey,
    }),
    [activeEnv, toolKey, username]
  );

  const scopeSignature = `${username || 'anonymous'}::${activeEnv || 'default'}::${toolKey || 'workspace'}`;

  const [activeScreen, setActiveScreenState] = useState(() =>
    readWorkbenchView(scope, resolveNextValue(initialScreen, 'default'))
  );

  useEffect(() => {
    setActiveScreenState(readWorkbenchView(scope, resolveNextValue(initialScreen, 'default')));
  }, [initialScreen, scope, scopeSignature]);

  useEffect(() => {
    if (!activeEnv) return;
    persistWorkbenchView(scope, activeScreen);
  }, [activeEnv, activeScreen, scope, scopeSignature]);

  const setActiveScreen = (nextValue) => {
    setActiveScreenState((previousValue) => {
      const resolvedValue =
        typeof nextValue === 'function' ? nextValue(previousValue) : nextValue;
      return resolveNextValue(resolvedValue, initialScreen);
    });
  };

  return [activeScreen, setActiveScreen];
};

export default usePersistedWorkbenchScreen;
