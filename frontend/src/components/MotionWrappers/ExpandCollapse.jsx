import { motion, AnimatePresence } from 'framer-motion';
import { Box } from '@mui/material';

export const ExpandCollapse = ({ children, isOpen }) => {
  return (
    <AnimatePresence initial={false}>
      {isOpen && (
        <Box
          component={motion.div}
          initial={{ height: 0, opacity: 0 }}
          animate={{ height: "auto", opacity: 1 }}
          exit={{ height: 0, opacity: 0 }}
          transition={{ duration: 0.3, ease: "easeInOut" }}
          style={{ overflow: "hidden" }} // Crucial for clean height animation
        >
          {/* Inner padding wrapper prevents content squashing */}
          <Box sx={{ py: 1 }}> 
            {children}
          </Box>
        </Box>
      )}
    </AnimatePresence>
  );
};