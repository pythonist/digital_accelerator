import { motion, AnimatePresence } from 'framer-motion';
import { Box } from '@mui/material';
// Container variant - Staggers children animations
const containerVariants = {
  hidden: { opacity: 0 },
  show: {
    opacity: 1,
    transition: {
      staggerChildren: 0.1
    }
  }
};

// Item variant - Fade in and slide up
const itemVariants = {
  hidden: { opacity: 0, y: 20 },
  show: { opacity: 1, y: 0 }
};

/**
 * Wrapper for a list or container that staggers its children
 */
export const MotionContainer = ({ children, ...props }) => (
  <Box
    component={motion.div}
    variants={containerVariants}
    initial="hidden"
    animate="show"
    {...props}
  >
    {children}
  </Box>
);

/**
 * Wrapper for individual items in a list
 */
export const MotionItem = ({ children, ...props }) => (
  <Box
    component={motion.div}
    variants={itemVariants}
    {...props}
  >
    {children}
  </Box>
);

export const FadeIn = ({ children, delay = 0, duration = 0.5 }) => {
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration, delay, ease: "easeOut" }}
      style={{ width: '100%' }} // Ensures wrapper fills space
    >
      {children}
    </motion.div>
  );
};

const transition = { duration: 0.4, ease: [0.43, 0.13, 0.23, 0.96] };

const pageVariants = {
  initial: { opacity: 0, y: 10 }, // Start slightly below and invisible
  enter: { opacity: 1, y: 0, transition },
  exit: { opacity: 0, y: -10, transition: { duration: 0.2 } }
};

export const PageTransition = ({ children, ...props }) => {
  return (
    <Box
      component={motion.div}
      initial="initial"
      animate="enter"
      exit="exit"
      variants={pageVariants}
      {...props}
      // Ensures the animation doesn't mess up layout flow
      style={{ width: '100%', height: '100%' }} 
    >
      {children}
    </Box>
  );
};

// ... (Kp your existing MotionContainer, MotionItem, FadeIn, PageTransition) ...

// --- NEW COMPONENTS BELOW ---

/**
 * SlideSwitcher: Use this for switching tabs or screens (like Login Step 1 -> Step 2)
 * It handles the exit and entry animations smoothly.
 */
const slideVariants = {
  enter: (direction) => ({
    x: direction > 0 ? 50 : -50,
    opacity: 0
  }),
  center: {
    zIndex: 1,
    x: 0,
    opacity: 1
  },
  exit: (direction) => ({
    zIndex: 0,
    x: direction < 0 ? 50 : -50,
    opacity: 0
  })
};

export const SlideSwitcher = ({ children, itemKey, direction = 1, duration = 0.4 }) => {
  return (
    <AnimatePresence mode="wait" custom={direction}>
      <motion.div
        key={itemKey}
        custom={direction}
        variants={slideVariants}
        initial="enter"
        animate="center"
        exit="exit"
        transition={{
          x: { type: "spring", stiffness: 300, damping: 30 },
          opacity: { duration: 0.2 }
        }}
        style={{ width: '100%' }}
      >
        {children}
      </motion.div>
    </AnimatePresence>
  );
};

/**
 * ScaleIn: Great for alerts, errors, or success messages popping up
 */
export const ScaleIn = ({ children, delay = 0 }) => (
  <motion.div
    initial={{ opacity: 0, scale: 0.9 }}
    animate={{ opacity: 1, scale: 1 }}
    exit={{ opacity: 0, scale: 0.9 }}
    transition={{ duration: 0.3, delay, ease: [0.43, 0.13, 0.23, 0.96] }}
  >
    {children}
  </motion.div>
);