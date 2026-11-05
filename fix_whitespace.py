import sys

filepath = 'e:/Trae/AI_AML_tool/frontend/src/tools/mlops/components/ModelTrainingPanel.jsx'
with open(filepath, 'r', encoding='utf-8') as f:
    lines = f.readlines()

new_lines = []
in_grid = False
in_hyperparams = False
hyperparams_buffer = []

# We want to change the layout to:
# <Grid>
#   <Stack spacing={2.5}>
#      [Check Controls Title]
#      [Training Data Source]
#      [Split Policy]
#      [Split Date]
#      [Buttons]
#   </Stack>
#   [Model Hyperparameters]
# </Grid>

grid_start_idx = -1
for i, line in enumerate(lines):
    if "<Box sx={{ display: 'grid', gap: 1.5, gridTemplateColumns: { xs: '1fr', lg: 'minmax(0, 1.1fr) minmax(320px, 0.9fr)' }, alignItems: 'start' }}>" in line:
        grid_start_idx = i
        break

if grid_start_idx != -1:
    lines[grid_start_idx] = lines[grid_start_idx].replace("gap: 1.5", "gap: 2.5")
    # Insert <Stack spacing={2.5}> after grid start
    lines.insert(grid_start_idx + 1, "                <Stack spacing={2.5}>\n")
    
    # The grid ends at `              </Box>` right before `              <Box>` (Training Data Source)
    # The hyperparameters Paper ends right before that.
    hyperparams_start = -1
    hyperparams_end = -1
    for i in range(grid_start_idx, len(lines)):
        if '<Paper variant="outlined"' in lines[i] and 'borderColor: T.border' in lines[i] and 'Model hyperparameters' in lines[i+4]:
            hyperparams_start = i
        if hyperparams_start != -1 and '                </Paper>' in lines[i]:
            hyperparams_end = i
            break
    
    if hyperparams_start != -1 and hyperparams_end != -1:
        hyperparams_block = lines[hyperparams_start:hyperparams_end+1]
        
        # Delete hyperparams from current location
        del lines[hyperparams_start:hyperparams_end+1]
        
        # Now find the end of the bottom Stack (Revisit configure tab)
        stack_end = -1
        for i in range(hyperparams_start, len(lines)):
            if 'Revisit configure tab' in lines[i]:
                for j in range(i, len(lines)):
                    if '              </Stack>' in lines[j]:
                        stack_end = j
                        break
                break
        
        if stack_end != -1:
            # We insert the closing Stack
            lines.insert(stack_end + 1, "                </Stack>\n")
            
            # Then we insert the hyperparams block
            for h_line in reversed(hyperparams_block):
                lines.insert(stack_end + 2, h_line)
                
            # Then we move the closing </Box> of the grid from right before 'Training data source' to right after hyperparams
            grid_close_idx = -1
            for i in range(grid_start_idx, len(lines)):
                if 'Training data source' in lines[i]:
                    for j in range(i-1, 0, -1):
                        if '              </Box>' in lines[j]:
                            grid_close_idx = j
                            break
                    break
            
            if grid_close_idx != -1:
                grid_close_line = lines.pop(grid_close_idx)
                # insert it after the inserted hyperparams
                # We need to find hyperparams end again
                for i in range(stack_end + 2, len(lines)):
                    if '                </Paper>' in lines[i]:
                        lines.insert(i + 1, grid_close_line)
                        break

with open(filepath, 'w', encoding='utf-8') as f:
    f.writelines(lines)
