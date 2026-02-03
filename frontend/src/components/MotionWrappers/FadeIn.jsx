import { motion } from 'framer-motion';

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