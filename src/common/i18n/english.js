// Fallback patterns for runtime-composed UI messages. Static messages use stable IDs in messages.js.
export function translateEnglishUiText(text, language, translateUiText) {
  const upcoming = {
    '正在烘焙导出贴图': 'Baking export textures',
    '烘焙贴图超出可用尺寸，请减少帧数或平铺范围': 'The baked texture exceeds the supported size. Reduce the frame count or tiled span.',
    '打開項目首頁': 'Open project home',
    '刪除項目': 'Delete project',
    '保存並關閉': 'Save and close',
    '不保留': 'Discard',
    '從未保存': 'Never saved',
    '已保存的工作項目': 'Saved working project',
    '從未保存的工作項目': 'Never-saved working project',
    '正在讀取歷史記錄': 'Loading history',
    '歷史記錄讀取失敗': 'Could not load history',
    '歷史記錄': 'History',
    '標記節點': 'Mark node',
    '編輯節點標記': 'Edit node mark',
    '標記歷史節點': 'Mark history node',
    '標記形狀': 'Mark shape',
    '正菱形': 'Diamond',
    '六邊形': 'Hexagon',
    '五角星': 'Five-pointed star',
    '移除標記': 'Remove mark',
    '無效的歷史節點標記': 'Invalid history node mark',
    '項目歷史分支圖': 'Project history tree',
    '目前狀態': 'Current state',
    '歷史記錄僅在桌面版可用': 'History is available in the desktop application',
    '切換到此歷史狀態': 'Restore this history state',
    '切換歷史狀態': 'Restore history state',
    '刪除單個節點': 'Delete this node only',
    '刪除節點及後續整個分支': 'Delete this node and its entire branch',
    '至少需要保留一個歷史狀態': 'At least one history state must remain',
    '只刪除此歷史節點？後續記錄會保留。': 'Delete only this history node? Later records will be kept.',
    '刪除此節點及其全部後續分支？': 'Delete this node and all its descendant branches?',
    '刪除歷史節點': 'Delete history node',
    '刪除歷史分支': 'Delete history branch',
    '刪除單個歷史節點': 'Delete a single history node',
    '刪除節點': 'Delete node',
    '刪除分支': 'Delete branch',
    '這項操作無法撤銷。如果目前狀態被刪除，會先還原到仍保留的父節點或鄰近歷史狀態。': 'This cannot be undone. If the current state is deleted, a retained parent or nearby history state will be restored first.',
    '已保存的項目不能自動刪除': 'Saved projects cannot be deleted automatically',
    '項目': 'Project',
    '正在讀取工作項目': 'Reading working project',
    '正在還原模型與貼圖': 'Restoring model and textures',
    '項目已載入': 'Project loaded',
    '將刪除這個項目的本機文件夾及全部歷史記錄，無法撤銷。已導出的模型文件不受影響。': 'This permanently deletes the local project folder and its entire history. Exported model files are not affected.',
    '這個新建項目從未保存。保存後會一直保留在項目文件夾中。': 'This new project has never been saved. Saving keeps its working folder permanently.',
    '以下僅列出從未保存的新建項目。勾選即可保存並保留；取消勾選會刪除該項目的本機工作記錄。保存過的項目會自動保存並永久保留，不會在此列出。': 'Only new, never-saved projects are listed. Checked projects will be saved and retained; unchecked projects lose their local working records. Previously saved projects are saved automatically, retained permanently, and omitted from this list.',
    '默認': 'Default',
    '開始記錄 8 秒，請持續操作主視圖': 'Recording for 8 seconds; keep interacting with the viewport',
    '性能記錄已複製到剪貼板': 'Performance report copied to the clipboard',
    '無法複製性能記錄，請查看開發者工具': 'Could not copy the performance report; check Developer Tools',
    '項目封面讀取失敗': 'Could not load the project cover',
    '項目首頁載入失敗': 'Could not load the project home page',
    '貼圖模式': 'Texture mode',
    '複製': 'Copy',
    '貼上': 'Paste',
    '剪切': 'Cut',
    '原地複製': 'Duplicate',
    '幀': 'Frames',
    '＋ 幀': '+ Frame',
    '尚無幀元素': 'No frame elements',
    '新增幀元素': 'Add frame element',
    '刪除幀元素': 'Delete frame element',
    '剪切幀元素': 'Cut frame element',
    '貼上幀元素': 'Paste frame element',
    '原地複製幀元素': 'Duplicate frame element',
    '調整幀元素順序': 'Reorder frame elements',
    '切換貼圖手翻書屬性': 'Toggle texture flipbook attribute',
    '連接幀與圖層': 'Connect frame and layer',
    '斷開幀與圖層': 'Disconnect frame and layer',
    '幀與圖層連線': 'Frame and layer connections',
    '幀漸變': 'Frame interpolation',
    '幀進度': 'Frame position',
    '顯示或隱藏幀進度條': 'Show or hide the frame timeline',
    '當前幀沒有可編輯圖層': 'This frame has no editable layer',
    '更改幀內圖層顯隱': 'Change frame-local layer visibility',
    '選擇幀內繪畫圖層': 'Select frame paint layer',
    '更改手翻書播放設置': 'Change flipbook playback settings',
    '播放': 'Play',
    '暫停': 'Pause',
    '動畫尺寸與時間必須是正整數': 'Animation dimensions and timing must be positive integers',
    '動畫單幀尺寸無法整齊切分貼圖': 'Animation frame dimensions do not divide the texture evenly',
    '貼圖動畫包含過多圖像': 'The texture animation contains too many images',
    '貼圖動畫包含過多幀': 'The texture animation contains too many frames',
    '動畫幀索引超出貼圖範圍': 'An animation frame index is outside the texture',
    'X 偏移（px）': 'X offset (px)',
    'Y 偏移（px）': 'Y offset (px)',
    '整個面的平鋪寬度（px）': 'Full face width (px)',
    '整個面的平鋪高度（px）': 'Full face height (px)',
    'UV X 起點（px）': 'UV X origin (px)',
    'UV Y 起點（px）': 'UV Y origin (px)',
    'UV 寬度（px）': 'UV width (px)',
    'UV 高度（px）': 'UV height (px)',
    '手翻書': 'Flipbook',
    '平鋪': 'Tiled',
    '動畫編輯': 'Animation Editing',
    '動畫編輯（開發中）': 'Animation Editing (in development)',
    '動畫編輯 · 即將推出': 'Animation Editing · Coming Soon',
    '平鋪（即將推出）': 'Tiled (Coming Soon)',
    '手翻書（即將推出）': 'Flipbook (Coming Soon)',
    '色卡檔案不能超過 2 MB': 'Color-map files cannot exceed 2 MB',
    '匯入後不能超過 256 行色卡': 'The imported palette cannot exceed 256 rows',
    'Blockbench 風格操作': 'Blockbench-style controls',
    '應用位移': 'Apply position',
    '還原位移': 'Restore position',
    '應用旋轉': 'Apply rotation',
    '還原旋轉': 'Restore rotation',
    '應用元素位移': 'Apply element position',
    '還原已應用位移': 'Restore applied position',
    '應用元素旋轉': 'Apply element rotation',
    '還原已應用旋轉': 'Restore applied rotation',
    '自動裁剪至模型像素': 'Auto-crop to model pixels',
    '如果希望使用 BB 风格的界面操作，可以进入设置调整': 'To use Blockbench-style controls, change the option in Settings',
    '只導出目前選中的色卡為 .cbcmap；檔案不包含名稱': 'Export only the selected palette as .cbcmap; the file does not include its name',
    '追加匯入 .cbcmap 色卡': 'Append a .cbcmap palette',
    'GeckoLib 模型目前暫停新建': 'Creating GeckoLib models is temporarily unavailable',
    '工作記錄尚未寫入，請稍後重試': 'The work journal has not been written yet; try again shortly',
    '色卡保存失敗': 'Could not save the palette',
    '色卡檔案格式或數量無效': 'Invalid color-map format or number of palettes',
    '色階映射': 'Gradient mapping',
    '取來源亮度與透明度作蒙版；來源隱藏時仍生效。': 'Use source brightness and alpha as the mask; it remains active when the source is hidden.',
    '保留圖層結構': 'Preserve layer structure',
    '指定基礎色與灰度': 'Set base color and gray level',
    '指定基礎位置與灰度': 'Set base position and gray level',
    '基礎灰度 %': 'Base gray level %',
    '基礎色': 'Base color',
    '基礎色卡位置 %': 'Base palette position %',
    '工作項目已保留在項目資料夾': 'Work project retained in the project folder',
    '視窗控制': 'Window controls',
    '最大化': 'Maximize',
    '最小化': 'Minimize',
    '無蒙版': 'No mask',
    '匯入': 'Import',
    '匯入檔案沒有色卡': 'The imported file contains no palettes',
    '填充內部': 'Fill interior',
    '填滿矩形或橢圓內部': 'Fill the inside of a rectangle or ellipse',
    '源色卡': 'Source palette',
    '圖形': 'Shape',
    '已移除的色卡（使用保存的顏色）': 'Removed palette (using saved colors)',
    '圖形繪製': 'Shape drawing',
    '圖形繪製（目前：直線）': 'Shape drawing (current: line)',
    '蒙版來源': 'Mask source',
    '模板底圖': 'Template base layer',
    '請先建立有顏色的色卡': 'Create a palette with colors first',
    '請先選擇色卡': 'Select a palette first',
    '還原視窗': 'Restore window',
    '瀏覽器預覽無法保留工作目錄，請使用導出': 'Browser preview cannot retain the work folder; use Export',
    '顯示設置': 'Display settings',
    '顯示設置 · 即將推出': 'Display settings · Coming Soon',
    '左側對應亮部，右側對應暗部。原始像素與透明度不會被修改。': 'The left maps to highlights and the right to shadows. Original pixels and alpha remain unchanged.',
    '顯示設置（開發中）': 'Display settings (in development)',
    '正在保存重排後的圖層…': 'Saving the rearranged layers…',
    '皮膚模型目前暫停新建': 'Creating skin models is temporarily unavailable',
    '色卡已導出': 'Palette exported',
    '色卡分段數': 'Palette steps',
    '色卡名稱或顏色資料無效': 'Invalid palette name or color data',
    '左鍵拖動旋轉、右鍵拖動平移；Shift + 左鍵框選': 'Left-drag to orbit, right-drag to pan; Shift + left-drag to box-select',
    '依新 UV 重排各圖層像素，保留組與混合設定': 'Rearrange each layer for the new UVs while preserving groups and blend settings'
  };
  if (upcoming[text]) return upcoming[text];
  if(text.startsWith('動畫配置讀取失敗：'))return `Could not load animation metadata: ${translateUiText(text.slice('動畫配置讀取失敗：'.length),language)}`;
  if(text.startsWith('已導入動畫貼圖 '))return `Imported animated texture ${text.slice('已導入動畫貼圖 '.length)}`;
  let match = text.match(/^背景：(純黑|目前背景|棋盤格)$/);
  if (match) return `Background: ${translateUiText(match[1], language)}`;
  match = text.match(/^不支援拖入 (.+)$/);
  if (match) return `Unsupported drop: ${match[1]}`;
  match = text.match(/^無法取得 (.+) 的本機路徑$/);
  if (match) return `Could not find the local path for ${match[1]}`;
  match = text.match(/^已匯入 (\d+) 行色卡$/);
  if (match) return `Imported ${match[1]} palette rows`;
  match = text.match(/^尚未加入(.+)$/);
  if (match) return `No ${translateUiText(match[1], language)} packs added yet`;
  match = text.match(/^移除「(.+)」？$/);
  if (match) return `Remove “${match[1]}”?`;
  match = text.match(/^匯入色卡 (\d+)$/);
  if (match) return `Imported palette ${match[1]}`;
  match = text.match(/^歷史裁剪未完成：(.+)$/);
  if (match) return `History compaction incomplete: ${match[1]}`;
  match = text.match(/^圖形繪製（目前：(.+)）$/);
  if (match) return `Shape drawing (current: ${translateUiText(match[1], language)})`;
  match = text.match(/^複製像素：(開|關)$/);
  if (match) return `Copy pixels: ${match[1] === '開' ? 'On' : 'Off'}`;
  match = text.match(/^(二維|三維)(包絡)?貝塞爾$/);
  if (match) return `${match[1] === '二維' ? '2D' : '3D'} ${match[2] ? 'envelope ' : ''}Bezier`;
  match = text.match(/^等距縮放 (\d+) 項$/);
  if (match) return `Uniform scale · ${match[1]} items`;
  match = text.match(/^等距尺寸 (.+)$/);
  if (match) return `Uniform size ${translateUiText(match[1], language)}`;
  match = text.match(/^(\d+) 行 · 每行獨立設定$/);
  if (match) return `${match[1]} rows · configured independently`;
  match = text.match(/^色彩空間漸變 · (.+)$/);
  if (match) return `Color-space gradient · ${match[1]}`;
  match = text.match(/^多選 (\d+)$/);
  if (match) return `${match[1]} selected`;
  match = text.match(/^節點 (\d+)$/);
  if (match) return `Node ${match[1]}`;
  match = text.match(/^(\d+) 節點$/);
  if (match) return `${match[1]} nodes`;
  match = text.match(/^吸附 (.+) · (.+)px$/);
  if (match) return `Snap ${match[1]} · ${match[2]}px`;
  match = text.match(/^目前按項目基礎吸附 (.+) 計算：UV 像素 = round\(Cube 尺寸 × (.+) ÷ 16\)，(?:非零邊長最少 1px，)?再由大到小自左上角打包。$/);
  if (match) return `Using project base snap ${match[1]}: UV pixels = round(Cube size × ${match[2]} ÷ 16), with at least 1 px for every non-zero edge, then packed largest-first from the top-left.`;
  match = text.match(/^正在準備 (\d+) 個面…$/);
  if (match) return `Preparing ${match[1]} faces…`;
  match = text.match(/^已(剔除|恢復) (\d+) 個面$/);
  if (match) return `${match[1] === '剔除' ? 'Culled' : 'Restored'} ${match[2]} faces`;
  match = text.match(/^全部面已剔除，已刪除 (\d+) 個 Cube$/);
  if (match) return `All faces were culled; deleted ${match[1]} cubes`;
  match = text.match(/^已將貼圖套用到 (\d+) 個 Cube 的(.+)$/);
  if (match) return `Applied the texture to ${match[1]} cubes' ${match[2]}`;
  match = text.match(/^已將貼圖套用到(.+)$/);
  if (match) return `Applied the texture to the ${match[1]}`;
  match = text.match(/^標準吸附 (.+) · (.+)px$/);
  if (match) return `Standard snap ${match[1]} · ${match[2]}px`;
  match = text.match(/^關閉 (.+)$/);
  if (match) return `Close ${match[1]}`;
  match = text.match(/^介面語言：(.*)$/);
  if (match) return `Interface language: ${match[1]}`;
  match = text.match(/^玩家參考紋理：(.*)$/);
  if (match) return `Player reference texture: ${match[1]}`;
  match = text.match(/^已導入(一般視圖|[XYZ] 軸視圖)參考圖 · (\d+) 張$/);
  if (match) return `Imported ${match[2]} reference images for ${match[1] === '一般視圖' ? 'the general view' : `the ${match[1][0]}-axis view`}`;
  match = text.match(/^已導入 (\d+) 張參考圖，部分檔案無法讀取$/);
  if (match) return `Imported ${match[1]} reference images; some files could not be read`;
  match = text.match(/^已沿 ([XYZ]) 軸切割 (.+)$/);
  if (match) return `Cut ${match[2]} along the ${match[1]} axis`;
  match = text.match(/^預覽：(豎切|橫切)$/);
  if (match) return `Preview: ${match[1] === '豎切' ? 'vertical cut' : 'horizontal cut'}`;
  match = text.match(/^已(豎切|橫切|完成切割) (.+)（([XYZ]) 軸）$/);
  if (match) return `${match[1] === '豎切' ? 'Vertically cut' : match[1] === '橫切' ? 'Horizontally cut' : 'Cut'} ${match[2]} on the ${match[3]} axis`;
  match = text.match(/^樞軸 (.+)$/);
  if (match) return `Pivot ${match[1]}`;
  match = text.match(/^(.+) 個$/);
  if (match) return match[1];
  match = text.match(/^(.+?)失敗：(.+)$/);
  if (match) return `${translateUiText(match[1], language)} failed: ${translateUiText(match[2], language)}`;
  match = text.match(/^已(建立|新增|打開|導入|導出|複製|剪切|刪除|恢復|剔除|選|套用|烘焙)\s*(.+)$/);
  if (match) {
    const verbs = { 建立: 'Created', 新增: 'Added', 打開: 'Opened', 導入: 'Imported', 導出: 'Exported',
      複製: 'Copied', 剪切: 'Cut', 刪除: 'Deleted', 恢復: 'Restored', 剔除: 'Culled',
      選: 'Selected', 套用: 'Applied', 烘焙: 'Baked' };
    return `${verbs[match[1]]} ${translateUiText(match[2], language)}`;
  }
  match = text.match(/^(目前渲染模式|目前|預覽)：(.+)$/);
  if (match) return `${{ 目前渲染模式: 'Current render mode', 目前: 'Current', 預覽: 'Preview' }[match[1]]}: ${translateUiText(match[2], language)}`;
  match = text.match(/^(節點|圖層|貼圖組|漸變節點)\s*(\d+)$/);
  if (match) return `${translateUiText(match[1], language)} ${match[2]}`;
  match = text.match(/^(角度|距離|尺寸|滾動角|半徑|高度)\s+(.+)$/);
  if (match) return `${translateUiText(match[1], language)} ${match[2]}`;
  match = text.match(/^正在(建立|準備|截取|離屏渲染)(.+)$/);
  if (match) return `${{ 建立: 'Creating', 準備: 'Preparing', 截取: 'Capturing', 離屏渲染: 'Rendering offscreen' }[match[1]]}${match[2]}`;
  match = text.match(/^是否保留「(.+)」？$/);
  if (match) return `Keep “${match[1]}”?`;
  match = text.match(/^確定刪除「(.+)」？$/);
  if (match) return `Delete “${match[1]}”?`;
  match = text.match(/^正在讀取歷史記錄 (\d+)%$/);
  if (match) return `Loading history ${match[1]}%`;
  match = text.match(/^歷史清理未完成：(.+)$/);
  if (match) return `History cleanup incomplete: ${match[1]}`;
  match = text.match(/^「(.+)」尚未保存，仍要關閉嗎？$/);
  if (match) return `“${match[1]}” has not been saved. Close it anyway?`;
  match = text.match(/^找到 (\d+) 個未保存的工作項目。要全部恢復到分頁嗎？$/);
  if (match) return `Found ${match[1]} unsaved working projects. Restore all as tabs?`;
  match = text.match(/^找到未保存的工作項目「(.+)」。要恢復嗎？$/);
  if (match) return `Restore the unsaved working project “${match[1]}”?`;
  match = text.match(/^(\d+) 個 Shape 包項目未載入，詳見主控台$/);
  if (match) return `${match[1]} Shape pack items failed to load; see the console`;
  match = text.match(/^已清理 (\d+) 個無效面；沒有可建立模板的面$/);
  if (match) return `Cleaned ${match[1]} invalid faces; no faces remain for the template`;
  match = text.match(/^模板尺寸 (.+) 過大，請降低吸附分辨率或間隔$/);
  if (match) return `Template size ${match[1]} is too large; lower the snap resolution or spacing`;
  match = text.match(/^(.+) · (北|南|東|西|上|下)( · 已剔除)?$/);
  if (match) return `${match[1]} · ${{ 北: 'North', 南: 'South', 東: 'East', 西: 'West', 上: 'Up', 下: 'Down' }[match[2]]}${match[3] ? ' · Culled' : ''}`;
  match = text.match(/^(平面等距|等比尺寸|等比縮放|縮放) (.+)$/);
  if (match) return `${{ 平面等距: 'Uniform plane scale', 等比尺寸: 'Proportional size', 等比縮放: 'Uniform scale', 縮放: 'Scale' }[match[1]]} ${match[2]}`;
  match = text.match(/^(前手柄|後手柄|對稱軸點) (.+)$/);
  if (match) return `${translateUiText(match[1], language)} ${match[2]}`;
  match = text.match(/^(\d+) 行 · 縮略選色$/);
  if (match) return `${match[1]} rows · compact palette`;
  match = text.match(/^(.+) · 節點 (\d+)$/);
  if (match) return `${match[1]} · Node ${match[2]}`;
  match = text.match(/^(離屏渲染 · 自動框住可見模型|屏幕截圖 · 僅當前視窗範圍) · (.+)$/);
  if (match) return `${match[1].startsWith('離屏') ? 'Offscreen render · fit visible model' : 'Screenshot · current viewport only'} · ${match[2]}`;
  match = text.match(/^折疊(左側|右側|底部)停靠區$/);
  if (match) return `Collapse ${{ 左側: 'left', 右側: 'right', 底部: 'bottom' }[match[1]]} dock`;
  match = text.match(/^刪除(組及其內容|物件)$/);
  if (match) return match[1] === '物件' ? 'Delete object' : 'Delete group and contents';
  match = text.match(/^吸附精度 (.+)（(.+) px）$/);
  if (match) return `Snap precision ${match[1]} (${match[2]} px)`;
  match = text.match(/^無貼圖 · (.+)$/);
  if (match) return `No texture · ${match[1]}`;
  match = text.match(/^(.+) · 唯讀$/);
  if (match) return `${match[1]} · Read-only`;
  match = text.match(/^文件無法讀取：(.+)$/);
  if (match) return `Cannot read file: ${match[1]}`;
  match = text.match(/^未安裝的 Shape：(.+)$/);
  if (match) return `Shape not installed: ${match[1]}`;
  match = text.match(/^參考圖快照缺失：(.+)$/);
  if (match) return `Reference-image snapshot missing: ${match[1]}`;
  match = text.match(/^Shape (.+) 的 fields 不合法$/);
  if (match) return `Shape ${match[1]} has invalid fields`;
  match = text.match(/^Shape ID 已存在：(.+)$/);
  if (match) return `Shape ID already exists: ${match[1]}`;
  match = text.match(/^已加入「(.+)」 (.+)$/);
  if (match) return `Added ${match[2]} to “${match[1]}”`;
  match = text.match(/^繪畫顏色 (.+)$/);
  if (match) return `Paint color ${match[1]}`;
  match = text.match(/^自定義 (.+)$/);
  if (match) return `Custom ${match[1]}`;
  match = text.match(/^修改元素(.+)$/);
  if (match) return `Edit element ${translateUiText(match[1], language)}`;
  match = text.match(/^修改(.+)三軸參數$/);
  if (match) return `Edit ${translateUiText(match[1], language)} axis values`;
  match = text.match(/^修改(.+)：(.+)$/);
  if (match) return `Edit ${translateUiText(match[1], language)}: ${translateUiText(match[2], language)}`;
  match = text.match(/^修改(.+)$/);
  if (match) return `Edit ${translateUiText(match[1], language)}`;
  return text;
}
