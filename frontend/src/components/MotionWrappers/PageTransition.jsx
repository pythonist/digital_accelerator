import { motion } from 'framer-motion';
import { Box } from '@mui/material';

// Standard "Enterprise" easing - smooth but snappy
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