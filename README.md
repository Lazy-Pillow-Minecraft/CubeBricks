# CubeBricks

CubeBricks 是一個以 Cube 與程序化 Shape 為核心的 Minecraft 桌面建模器原型。  
CubeBricks is a prototype Minecraft desktop modeler centered around Cubes and procedural Shapes.

啟動與新建專案預設為空場景、空貼圖，不再自動加入示例模型或示例材質。  
On startup and when creating a new project, CubeBricks now defaults to an empty scene and empty textures, without automatically adding sample models or materials.

介面標誌與桌面／快捷方式圖標分別位於 `src/assets/brand-icon.png` 和 `src/assets/shortcut-icon.png`（Windows 同時提供 `.ico`）。外觀設定內另提供以標誌的棕黑、琥珀金與奶油白為基礎的「琥珀」主題。  
The interface logo and desktop/shortcut icons are located at `src/assets/brand-icon.png` and `src/assets/shortcut-icon.png` respectively (with an additional `.ico` provided on Windows). Appearance settings also include an “Amber” theme based on the logo's dark brown, amber gold, and cream white palette.

## 啟動 / Getting Started

```powershell
npm install
npm start
```

若遠端桌面或虛擬機器沒有可用的 GPU 程序，可改用軟體渲染：  
If no usable GPU process is available in a remote desktop or virtual machine environment, software rendering can be used instead:

```powershell
npm run start:safe
```

只想快速預覽介面時：  
To quickly preview the interface only:

```powershell
npm run preview
```

然後打開 `http://127.0.0.1:8765`。  
Then open `http://127.0.0.1:8765`.

### Windows 單文件打包 / Windows Portable Build

安裝過 Node.js 後，可直接雙擊專案根目錄的 `build-portable.bat`。工具會自動補齊打包依賴、執行語法檢查與三組測試，再使用 Electron Builder 產生單一免安裝執行文件：
After installing Node.js, double-click `build-portable.bat` in the project root. The helper installs missing build dependencies, runs syntax checks and all three test suites, then uses Electron Builder to create a single portable executable:

```text
dist/CubeBricks-<version>-portable.exe
```

也可在終端直接執行 `npm run dist:portable`。首次打包需要網路以安裝依賴及取得 Electron 打包資源；之後會重用本機快取。Portable 版本不需要安裝，雙擊 `.exe` 即可啟動。
You can also run `npm run dist:portable` in a terminal. The first build needs network access to install dependencies and obtain Electron packaging resources; later builds reuse the local cache. The portable build requires no installation and starts by double-clicking the `.exe`.

目前版本包含可互動工作區、Cube／Shape／Node／二維與三維 Bezier／Group／Locator 資料模型、`.cbmodel` 保存、`.bbmodel` 匯入與導出、屬性編輯、可增減的獨立漸變色卡，以及可保存的語言、吸附和外觀配置。
The current version includes an interactive workspace; Cube, Shape, Node, 2D/3D Bezier, Group, and Locator data models; `.cbmodel` saving; `.bbmodel` import/export; property editing; independently manageable gradient palettes; and persistent language, snapping, and appearance settings.

### 最近更新 / Recent Updates

- 所有程序化 Shape 現在都支援非破壞式「細分編輯」：可由右鍵菜單或雙擊 Shape 進入，其他場景內容會暫時虛化且不可選，只保留該 Shape 生成的 Cube 供單獨調整幾何與 UV。修改會以 Cube 索引覆寫記錄在原 Shape 上，不會把臨時 Cube 寫入 `.cbmodel`；導出 `.bbmodel` 時則會套用覆寫後再展開。可用屬性面板、右鍵菜單、`Esc`，或雙擊主視圖空白背景退出。<br>
  Every procedural Shape now supports non-destructive Subdivision Edit. Enter through the context menu or by double-clicking a Shape; other scene content is temporarily faded and made unselectable, leaving the Shape's generated Cubes available for individual geometry and UV editing. Changes are stored as indexed Cube overrides on the original Shape, so transient Cubes are never written to `.cbmodel`; `.bbmodel` export applies the overrides before expansion. Exit through the inspector, context menu, `Esc`, or by double-clicking blank space in the main viewport.
- Shape 的「操作時保留已有細分編輯」選項可決定重新生成幾何時是否延續 Cube 覆寫；移動與旋轉整個 Shape 不會清除覆寫。貼圖窗口另支援按住 `Alt` 拖出共同 UV 矩形，直接把目前選中的單面或多面配置到同一區域，毋須先尋找原 UV 框；UV 邊與角也會顯示對應的縮放游標。<br>
  A Shape's “preserve existing subdivision edits during operations” option controls whether Cube overrides survive geometry regeneration; moving or rotating the whole Shape never clears them. In the texture dock, holding `Alt` while dragging creates a shared UV rectangle for all currently selected faces, without first locating their old UV bounds, and UV edges/corners now show the corresponding resize cursors.
- 組鏡像支援 XYZ 軸鏡像、徑向旋轉與曼陀羅模式，並以可編輯節點決定局部鏡像軸；預覽直接重用原幾何緩衝並在負行列式變換時修正繞序，避免鏡像結果翻成負形或反覆重建 Mesh。面選擇高亮亦改為低 Alpha 的 GPU 實色覆蓋，只更新獨立高亮緩衝，不再按面建立 SVG 或重建模型 Mesh。<br>
  Group mirroring supports XYZ-axis reflection, radial rotation, and mandala modes, with an editable node defining the local mirror frame. Preview instances reuse the original geometry buffers and correct winding for negative-determinant transforms, avoiding inverted mirrored results and repeated mesh rebuilding. Face-selection highlighting now uses a low-alpha solid GPU overlay that updates only its dedicated highlight buffer, without per-face SVG construction or model-mesh rebuilds.
- 貼圖窗口新增可選的「熱點聚焦」狀態：交互後以淡色主題框標記焦點，從貼圖窗口返回主視圖時，第一次點擊只切回主視圖焦點，不會誤觸空白取消選擇。聚焦貼圖窗口時，`R` 會以 `0.25 s` 緩動聚焦選中 UV，`Shift + R` 則緩動返回默認視圖。<br>
  The texture dock now supports optional hotspot focus. Interaction marks it with a subtle theme-colored outline, and the first click back in the main viewport only restores viewport focus instead of accidentally clearing the selection. While the texture dock is focused, `R` eases to the selected UVs over `0.25 s`, and `Shift + R` eases back to the default view.
- 貼圖窗口已加入完整的 UV 選取與基礎編輯：六個面向按鈕可批量選面；普通點擊替換選擇、Shift 追加、Ctrl 取消指定範圍。選中 UV 可由框內或空白拖動，並可從八個控制點調整範圍；移動與縮放沿用工程吸附及 Shift／Ctrl 微吸附，多選數值不一致時顯示 `-`。<br>
  The texture dock now provides complete UV selection and basic editing. Six directional buttons select matching faces in batches; a normal click replaces the selection, Shift adds, and Ctrl removes items in the target range. Selected UVs can be dragged from either their bounds or blank space and resized through eight handles. Move/resize operations use project snapping and the Shift/Ctrl fine-snap modifiers, while mixed multi-selection values display `-`.
- UV 視圖支援 Ctrl + 滾輪縮放、滾輪縱向捲動、Shift + 滾輪橫向捲動及中鍵任意平移，並具有四邊吸附。匯入時已超出貼圖的 UV 仍會如實顯示，但編輯操作不會主動把合法 UV 推出貼圖；空貼圖工程則使用工程貼圖尺寸作為工作區，不再退化成 `1 × 1`。<br>
  The UV view supports Ctrl + wheel zoom, vertical wheel scrolling, Shift + wheel horizontal scrolling, middle-button panning, and four-edge snapping. Imported out-of-bounds UVs remain visible, while editing will not actively push valid UVs outside the texture. Projects without an assigned image use the project's texture dimensions as the workspace instead of collapsing to `1 × 1`.
- 主視圖新增面選擇工具（快捷鍵 `7`），選面語義與貼圖窗口一致。選中面以低 Alpha 實色覆蓋明確標示，狀態改變只更新合併的 GPU 高亮緩衝、UV 視圖及 UV 預覽，不重建模型 Mesh；高亮共用主場景深度，保持正確遮擋。<br>
  The main viewport now includes a Face Select tool (shortcut `7`) with the same selection semantics as the texture dock. Selected faces are clearly marked by a low-alpha solid fill; selection changes update only a merged GPU highlight buffer, the UV view, and UV Preview without rebuilding model meshes, while sharing the main scene depth for correct occlusion.
- UV 線框改用螢幕像素座標的獨立 SVG 覆蓋層與半像素對齊，避免 CSS 縮放造成模糊；多選線框會合併為少量路徑。另加入無效 UV 回退及折疊／隱藏窗口尺寸保護，修正部分聚焦操作黑屏或跳變。<br>
  UV wireframes now use a separate screen-pixel SVG overlay with half-pixel alignment, avoiding blur caused by CSS scaling, and multi-selection wireframes are merged into a small number of paths. Invalid-UV fallbacks and collapsed/hidden-panel size guards also prevent black screens and jumps during focus operations.
- 多邊形柱體 Shape 改為沿每條多邊形邊生成一根長方體 Cube，使用斜接延長閉合牆角，不再體素填充截面；可選按構成 Cube 的實際邊長或按整體外輪廓吸附。<br>
  Polygon-prism Shapes now generate one elongated Cube along each polygon edge, using miter extensions to close wall corners instead of voxel-filling the cross-section. Snapping can follow either the generated Cubes' actual edge lengths or the overall outer bounds.
- 新增獨立節點、二維／三維 Bezier 元素與 Cube 柱擬合。未手動調整的節點使用鋼筆式平滑切線；手柄可直接拖動，二維節點固定共平面，三維節點則具有沿曲線插值並實際旋轉方形截面的獨立滾動角。<br>
  Standalone Nodes, 2D/3D Bezier elements, and Cube-column fitting have been added. Untouched nodes use pen-style smooth tangents; handles are directly draggable, 2D nodes remain coplanar, and 3D nodes have independent roll angles interpolated along the curve to rotate the square cross-section physically.
- 節點只提供移動與旋轉；樞軸工具在節點上等同移動節點自身。頂點捕捉支援節點，右鍵空白可在二維曲線真實平面或三維視覺平面建立相連節點；刀具可單擊合法連線將曲線拆成兩個至少各含兩節點的元素。<br>
  Nodes support movement and rotation only; the Pivot tool moves the node itself. Vertex snapping supports nodes, right-clicking blank space creates a connected node on the true 2D curve plane or the 3D view plane, and the Knife can split a valid connection into two elements containing at least two nodes each.
- 「導出」會建立 `.bbmodel`；程序化 Shape 與 Bezier 在導出時展開成以原物件命名的 Cube 組，保留普通 Cube、組層級、Locator、UV、面資料、可見性、旋轉和內嵌貼圖。<br>
  Export now creates `.bbmodel` files. Procedural Shapes and Bezier elements are expanded into Cube groups named after their source objects, while regular Cubes, hierarchy, Locators, UVs, face data, visibility, rotations, and embedded textures are preserved.
- 根目錄新增可雙擊的 `build-portable.bat`，會檢查原始碼、執行測試並在 `dist` 生成單一 Windows portable `.exe`。<br>
  A double-clickable `build-portable.bat` now checks the source, runs tests, and creates a single portable Windows `.exe` in `dist`.

- 左側新增標準停靠物件「UV 預覽」，只建立並渲染目前選中的 Cube／Shape。預覽可用左鍵獨立旋轉但不能縮放，並提供總開關、慢速自動旋轉與六面方向配色；總開關關閉、面板／停靠欄折疊或頁面進入後台時，動畫與 WebGL 渲染排程會完全停止。<br>
  A standardized “UV Preview” dock has been added to the bottom of the left column, building and rendering only the currently selected Cubes/Shapes. The preview can be rotated independently with the left mouse button but cannot be zoomed, and includes a master switch, slow auto-rotation, and directional six-face coloring. Animation and WebGL render scheduling stop completely when the master switch is off, the panel/dock is collapsed, or the page is in the background.
- 多選展開與場景節點查找改用運行時索引及選擇展開快取，不再為每個 UID 反覆線性掃描整份元素／組列表。以 5,000 個元素執行 50,000 次查找的本地基準中，查找時間由約 `1035 ms` 降至約 `6 ms`；索引為非序列化運行時資料，不會污染 `.cbmodel`／`.bbmodel`。<br>
  Multi-selection expansion and scene-node lookup now use runtime indices plus a cached selection expansion instead of repeatedly scanning the full element/group arrays for every UID. In a local benchmark of 50,000 lookups across 5,000 elements, lookup time fell from roughly `1035 ms` to about `6 ms`. These indices are non-serialized runtime data and do not pollute `.cbmodel` or `.bbmodel` files.
- 移動、縮放、旋轉、樞軸、頂點捕捉、刀具與 Locator 已換用正式 SVG 圖標，統一置中並繼承目前主題的工具欄顏色。  
  Move, Scale, Rotate, Pivot, Vertex Snap, Knife, and Locator now use finalized SVG icons, consistently centered and inheriting the current theme's toolbar color.
- Locator 不再以三軸十字線代替：視口會把正式 Locator SVG 投影到其三維座標，透視與正交各自使用正確的攝像機投影。圖標通常維持與工具欄一致的 `17 × 17` 尺寸；透視攝像機進入距離 `24` 以內後才隨接近程度放大，正交模式則始終保持固定尺寸。選中狀態與場景層級圖標也會套用主題色。<br>
  Locator is no longer represented by a three-axis crosshair: the viewport projects the finalized Locator SVG onto its 3D coordinates using the correct camera projection for perspective and orthographic views. The icon normally remains `17 × 17`, matching the toolbar; only when the perspective camera comes within a distance of `24` does it grow as the camera approaches, while orthographic mode always keeps it fixed. Selected-state and scene-hierarchy icons also inherit the theme color.
- 從主視口選中物件時，場景層級會自動展開其父組；若該項位於目前列表可視範圍之外，列表會以最短距離捲動到該項，不會重建或跳動整份列表。  
  When an object is selected from the main viewport, the scene hierarchy automatically expands its parent groups; if the item is outside the currently visible list area, the list scrolls the shortest distance necessary to reveal it without rebuilding or jumping the entire list.
- 新增樞軸移動、頂點捕捉與刀具切割工具。樞軸工具支援全局、父級與自身座標參考；無論拖動手柄或在屬性面板輸入數值，都會同步補償 Cube 位置或組內子項，確保幾何外觀完全不動。  
  Pivot movement, vertex snapping, and knife cutting tools have been added. The Pivot tool supports global, parent, and local coordinate references; whether the gizmo is dragged or values are entered in the properties panel, Cube positions or child items within groups are compensated accordingly so the visible geometry remains completely unchanged.
- 頂點捕捉只顯示目前選中項的頂點，移動模式另可直接選取樞軸點；採來源／目標兩段操作並允許兩點位於同一個 Cube。旋轉可選 X、Y、Z、最長軸或預設的樞軸點模式，選取來源後可在視口任意位置按右鍵取消。  
  Vertex snapping displays only the vertices of the currently selected item, while Move mode additionally allows direct selection of pivot points. It uses a two-step source/target workflow and allows both points to belong to the same Cube. Rotation can use X, Y, Z, the longest axis, or the default pivot-point mode, and can be cancelled by right-clicking anywhere in the viewport after selecting the source.
- 語言設定現已真正連接介面翻譯器；繁體中文、簡體中文與 English 均可即時切換，靜態頁面、動態屬性面板、工具提示、ARIA 標籤、搜尋提示及後續生成的右鍵選單會同步更新，不需要重啟。  
  Language settings are now fully connected to the interface translator; Traditional Chinese, Simplified Chinese, and English can be switched at runtime, with static pages, dynamic property panels, tooltips, ARIA labels, search hints, and subsequently generated context menus updating immediately without a restart.
- 自身旋轉新增姿態與 Z → Y → X 歐拉角模式；全局及父級旋轉維持姿態模式。旋轉角度另有獨立的 `2.5°`／`0.5°`／`15°`／`0.05°` 修飾鍵吸附。  
  Local rotation now supports both pose and Z → Y → X Euler-angle modes; global and parent-space rotation remain in pose mode. Rotation also has independent modifier-key snapping at `2.5°` / `0.5°` / `15°` / `0.05°`.
- 實體面陰影改用 Minecraft Java `minecraft_mix_light` 的雙方向光原式：`min(1, 0.4 + 0.6 × (L₀ + L₁))`，並繼續尊重全局與物件自身的 shade 開關。  
  Solid-face shading now uses the original bidirectional-light formula from Minecraft Java's `minecraft_mix_light`: `min(1, 0.4 + 0.6 × (L₀ + L₁))`, while continuing to respect both global and per-object shade toggles.
- 左側貼圖管理已精簡為選中貼圖預覽與貼圖列表，移除尚未形成完整工作流的假圖層、UV 與色階映射入口。  
  The left texture manager has been simplified to the selected-texture preview and texture list, removing placeholder layer, UV, and tonal-mapping entries that did not yet form a complete workflow.
- 停靠面板改為標準化物件，可直接拖離並靠近左、右、底部自動吸附；拖離過程即使面板重新掛載也不會丟失游標捕獲。  
  Dock panels are now standardized objects that can be dragged out directly and automatically snapped when brought near the left, right, or bottom docking areas; cursor capture is preserved even if a panel is remounted during detachment.
- 工具欄工具已註冊可見模式；編輯工具只在編輯／動畫所需模式出現，繪畫模式只保留繪畫工具。Cube、Shape、Locator 與組的建立入口已移到場景層級頂部，貼圖導入與貼圖組建立入口則位於貼圖列表頂部。<br>
  Toolbar tools now register their visible modes; editing tools only appear where required for Edit/Animation, while Paint mode keeps only painting tools. Cube, Shape, Locator, and Group creation has moved above the scene hierarchy, while texture import and texture-group creation live above the texture list.
- 場景層級支援 Ctrl／Shift 多選、拖動重排與拖入組；拖動時顯示選中項懸浮預覽、插入位置及落下後的短位移動畫。同目錄多選建立組會在第一個選中項的原位置直接包裹，保留原排列順序。<br>
  The scene hierarchy supports Ctrl/Shift multi-selection, drag reordering, and dropping into groups. Dragging shows a floating preview of the selected rows, a clear insertion target, and a short settling animation after drop. Grouping multiple items from the same directory wraps them in place at the first selected row while preserving their order.
- 刪除項目後保持空選；點擊視口或層級列表空白也會清空選擇。組可見性切換只在當下同步全部後代，之後仍可獨立重新顯示個別子項。<br>
  Deleting items leaves the selection empty, and clicking blank space in either the viewport or hierarchy also clears selection. Toggling group visibility synchronizes all descendants at that moment, while individual children may still be shown again independently afterward.
- 左右停靠區採用列表共用欄寬，同欄任意面板的內側邊都能調整整欄；新吸附的外來面板會繼承目標欄寬，不會反向覆蓋現有佈局。  
  The left and right docking areas use a shared column width per list; dragging the inner edge of any panel adjusts the entire column, and newly docked external panels inherit the target column width instead of overwriting the existing layout.
- Mipped 改用 1.5 倍高解析度離屏超採樣，只處理紋理模型表面；模型貼圖仍使用 `NEAREST`，不會被濾糊。  
  Mipped rendering now uses 1.5× high-resolution offscreen supersampling and only processes textured model surfaces; model textures still use `NEAREST` filtering and therefore remain sharp.
- 網格、選中框、邊界線、輔助線及線框模式使用獨立的原生 MSAA，不受 Mipped 開關影響，並透過模型深度預寫維持正確遮擋。  
  Grids, selection boxes, boundary lines, guides, and wireframe mode use independent native MSAA, unaffected by the Mipped toggle, with model depth prepasses preserving correct occlusion.

### 視口操作 / Viewport Controls

- 中鍵拖動：環繞旋轉（垂直 ±90°、水平 360°）  
  Middle-button drag: orbit rotation (vertical ±90°, horizontal 360°)
- Shift + 中鍵拖動：平移視圖並更新後續環繞旋轉的中心  
  Shift + middle-button drag: pan the view and update the center used for subsequent orbit rotation
- 滾輪：縮放  
  Mouse wheel: zoom
- `R`：聚焦選中的物體或組  
  `R`: focus the selected object or group
- `Shift + R`：將攝像機重新聚焦到世界中心  
  `Shift + R`: refocus the camera on the world origin
- 面選擇工具快捷鍵為 `7`；普通點擊替換選中面，Shift 追加，Ctrl 取消指定面，只更新合併高亮緩衝而不重建模型 Mesh<br>
  The Face Select tool uses shortcut `7`; normal click replaces selected faces, Shift adds, and Ctrl removes target faces, updating only the merged highlight buffer without rebuilding model meshes
- 視口左上角可真正切換透視與正交投影  
  The upper-left corner of the viewport provides a true perspective/orthographic projection toggle
- 視口右上角可切換線框、體塊、紋理三種渲染模式  
  The upper-right corner of the viewport switches between wireframe, solid, and textured rendering modes
- 地面由九宮格主網格與按吸附精度生成的中央細分網格組成，並標有坐標軸及北向  
  The ground consists of a 3×3 main grid plus a central subdivision grid generated according to snapping precision, with coordinate axes and north direction marked
- 左側「UV 預覽」只顯示選中幾何；左鍵拖動可旋轉小視口，且不接受滾輪縮放。面區分模式使用六種固定方向色，方便辨認 UV 面向；自動旋轉只影響預覽攝像機，不會修改模型資料。<br>
  The left-side “UV Preview” displays selected geometry only. Left-button dragging rotates its small viewport, while wheel zoom is intentionally unsupported. Face-color mode uses six fixed directional colors to make UV orientation easier to inspect, and auto-rotation affects only the preview camera without modifying model data.
- 貼圖窗口取得焦點後：`R` 聚焦選中 UV、`Shift + R` 返回默認視圖、Ctrl + 滾輪縮放、滾輪上下捲動、Shift + 滾輪左右捲動、中鍵拖動平移。這些操作只改變貼圖窗口內的視圖，不修改停靠窗口尺寸或主攝像機。<br>
  While the texture dock has focus: `R` focuses the selected UVs, `Shift + R` restores the default view, Ctrl + wheel zooms, the wheel scrolls vertically, Shift + wheel scrolls horizontally, and middle-button drag pans. These controls affect only the view inside the texture dock, without changing the dock size or the main camera.

紋理預覽提供實心、Cutout、半透明及三者的 Mipped 抗鋸齒版本；背面剔除、全局陰影和物件陰影均可獨立控制。透視模式使用對數深度以降低大可視距離下的 Z-fighting，Mipped 只對模型表面作高解析度離屏渲染後縮小；網格、選中框、邊界線和線框模式都繞過 Mipped，在所有模式下使用獨立的原生抗鋸齒。實體面亮度由旋轉後的法線套用 Minecraft Java `minecraft_mix_light` 雙方向光公式。Cube 的原生幾何欄位是 `position`、`size`、`pivot`、`rotation`；舊版 `from/to/origin` 僅在載入時自動遷移。  
Texture preview provides Solid, Cutout, Translucent, and Mipped anti-aliased variants of all three. Backface culling, global shading, and per-object shading can each be controlled independently. Perspective mode uses logarithmic depth to reduce Z-fighting over large view distances. Mipped rendering only supersamples model surfaces offscreen at high resolution before downscaling; grids, selection boxes, boundary lines, and wireframe mode bypass Mipped and use independent native anti-aliasing in every mode. Solid-face brightness applies Minecraft Java's bidirectional `minecraft_mix_light` formula to the rotated normals. A Cube's native geometry fields are `position`, `size`, `pivot`, and `rotation`; legacy `from/to/origin` fields are migrated automatically only when loading.

### 面板與組 / Panels and Groups

- 左側貼圖與 UV 預覽、右側物件屬性、右側場景層級及底部色卡／時間軸均為統一的停靠物件；直接拖動標題即可取下，靠近左、右或底部停靠區後鬆手會自動吸附，不需要切換按鈕。底部工作區只在繪畫與動畫模式存在，編輯模式會把空間完整交還視口。<br>
  The left texture and UV-preview panels, right object-properties panel, right scene hierarchy, and bottom palette/timeline are all unified dock objects. Drag a title directly to detach it; releasing near the left, right, or bottom docking area automatically snaps it into place without requiring a toggle button. The bottom workspace exists only in Paint and Animation modes, while Edit mode returns the entire area to the viewport.
- 左、右、底部都是可縱向堆疊任意數量面板的列表，拖放位置決定排列順序；左右列表中的面板共用欄寬，拖動任一面板的內側邊都會調整整欄，新吸附面板會繼承現有欄寬。每條停靠邊可整欄折疊，只在朝向主視圖的外沿留下小三角；即使該邊目前沒有面板，拖近時仍會顯示停靠預覽。<br>
  The left, right, and bottom areas are lists that can vertically stack any number of panels, with drop position determining order. Panels in the left and right lists share a column width; dragging the inner edge of any panel resizes the entire column, and newly docked panels inherit the existing width. Each docking edge can collapse as a whole, leaving only a small triangle on the outer edge facing the viewport; even an empty edge still displays a docking preview when a panel approaches.
- 每個窗口題頭均有獨立背景與分隔線，個別面板仍可自行折疊。浮動窗口除四邊外亦提供四角雙軸縮放；停靠區、順序、浮動位置、尺寸、共用欄寬、個別折疊及整欄折疊狀態都會自動保存。<br>
  Every window header has its own background and divider, and each panel can still be collapsed individually. Floating windows support two-axis resizing from all four corners in addition to edge resizing. Docking area, order, floating position, size, shared column width, individual collapse, and whole-edge collapse states are saved automatically.
- 每個停靠物件都有穩定 ID、數字索引、可見模式及預設佈局資料；目前索引可由 `CubeBricks.docks.list()` 查詢。  
  Every dock object has a stable ID, numeric index, visibility modes, and default-layout data; current indices can be queried with `CubeBricks.docks.list()`.
- 場景層級的 `▰＋` 可建立組。單選元素時在同目錄緊接其後建立；單選組時建立在組內尾部；多選同目錄項目時於原位置包裹；跨目錄多選則在最深共同父級下建立。選中的組本身也可作為元素被移入新組，組樞軸與歐拉角可直接編輯。<br>
  The `▰＋` control in the scene hierarchy creates a group. With one element selected, it is created immediately after that element in the same directory; with one group selected, it is appended inside that group; multiple items in one directory are wrapped in place; and selections across directories are grouped under their deepest common parent. Selected groups themselves can also be moved into the new group, and group pivots and Euler angles remain directly editable.
- 匯入 `.bbmodel` 時會保留巢狀 outliner 組、組樞軸、組旋轉與組可見性，渲染時按父子順序套用變換。  
  Importing `.bbmodel` preserves nested outliner groups, group pivots, group rotations, and group visibility, with transforms applied in parent-child order during rendering.

### 編輯與效能 / Editing and Performance

- 移動、縮放、旋轉工具只使用左鍵操作手柄；中鍵始終留給攝像機。  
  Move, Scale, and Rotate gizmos use the left mouse button only; the middle mouse button is always reserved for the camera.
- 樞軸工具使用與移動相同的軸、平面及中央手柄，並支援全局、父級、自身三種參考。樞軸變更會以 `Δ − R⁻¹Δ` 補償 Cube 位置；組樞軸則遞迴補償全部子項，因此模型在畫面中的位置和姿態不會改變。  
  The Pivot tool uses the same axes, planes, and center handle as Move, and supports global, parent, and local references. Pivot changes compensate Cube position using `Δ − R⁻¹Δ`; group pivots recursively compensate all children, so the model's on-screen position and orientation remain unchanged.
- 頂點捕捉只繪製目前選中項的頂點，移動模式同時提供獨立的樞軸點標記：先選來源，再選目標；中途切換場景層級選中項可捕捉到其他模型，也允許直接選同一 Cube 的兩個點。移動會換算父級空間位移；縮放以來源頂點的對角側為錨點；旋轉可鎖定 X、Y、Z、按最長旋轉軸自動判定，或使用預設的樞軸點自由對齊。  
  Vertex snapping draws only the vertices of the currently selected item, while Move mode also provides a separate pivot-point marker: select the source first, then the target. Switching the selected item in the scene hierarchy midway allows snapping to another model, and two points on the same Cube can also be selected directly. Move converts displacement into parent space; Scale anchors the diagonally opposite side of the source vertex; Rotate can lock to X, Y, or Z, automatically choose the longest rotation axis, or freely align using the default pivot-point mode.
- 刀具沒有軸向配置。游標射線會取得最前方 Cube 面，按移動工具及 Shift／Ctrl 的吸附精度在面上顯示短而清晰的三維十字；第一下固定切割點，第二點不另畫十字，只以環繞 Cube 一整圈的閉合線預覽橫切或豎切，右鍵可取消。切割後外表面 UV 會按比例分段保持原貌，新截面沿用對應方向的原面設定。  
  The Knife tool has no axis configuration. The cursor ray selects the frontmost Cube face and displays a short, clear 3D cross on the face according to the Move tool's snapping precision and the Shift/Ctrl modifiers. The first click fixes the cutting point; the second point does not draw another cross, but instead previews a horizontal or vertical cut using a closed line wrapping around the entire Cube. Right-click cancels the operation. After cutting, exterior UVs are proportionally split to preserve their original appearance, while new cross-sections inherit the original face settings for the corresponding direction.
- 移動和旋轉支援全局、父級、自身三種坐標系；自身旋轉可在姿態與 Z → Y → X 歐拉角模式間切換，其他坐標系固定使用姿態模式。縮放不顯示坐標系選項，並預設使用固定相對長度手柄，也可切換為貼合幾何。  
  Move and Rotate support global, parent, and local coordinate systems; local rotation can switch between pose and Z → Y → X Euler-angle modes, while the other coordinate systems remain fixed to pose mode. Scale does not display coordinate-system options and uses fixed relative-length handles by default, with an option to switch to geometry-fitting handles.
- 旋轉角度預設以 `2.5°` 吸附；按住 Shift 為 `0.5°`、Ctrl 為 `15°`、Shift+Ctrl 為 `0.05°`。  
  Rotation snaps to `2.5°` by default; holding Shift uses `0.5°`, Ctrl uses `15°`, and Shift+Ctrl uses `0.05°`.
- 移動與縮放手柄提供三個半透明平面方片，可在指定平面內移動或同時縮放兩軸；方片使用其平面法線軸的顏色，縮放方片外側的 L 形直角可讓平面內四個方向等距伸縮並保持中心。縮放中央方塊可用上下拖動等比縮放三軸，平面操作期間會延長對應的兩條軸線作為指示。  
  Move and Scale gizmos provide three translucent plane squares for moving within a specified plane or scaling two axes simultaneously. Each square uses the color of its plane-normal axis. The L-shaped corner outside a scale square expands or contracts all four directions within the plane equally while preserving the center. Dragging the central scale cube vertically performs uniform three-axis scaling, and the two corresponding axis lines extend as visual guides during plane operations.
- 貼圖面板只保留貼圖列表與目前選中貼圖的比例預覽；貼圖可拖動排序、放入貼圖組或從右鍵選單建立新組。視口中的模型物件與場景層級中的同一物件共用完全相同的右鍵菜單，空白視口則保留場景級操作。<br>
  The texture panel retains only the texture list and an aspect-ratio preview of the currently selected texture. Textures can be reordered by dragging, dropped into texture groups, or placed into a new group from the context menu. A model object in the viewport uses exactly the same context menu as the same object in the scene hierarchy, while blank viewport space retains scene-level actions.
- 場景使用穩定的基礎 Mesh 與獨立選中 Mesh；場景層級只建立可見行，拖動面板時不會重建整份列表。  
  The scene uses stable base Meshes and separate selection Meshes; the scene hierarchy creates only visible rows and does not rebuild the entire list while panels are being dragged.
- 場景節點及父組關係以惰性運行時 Map 索引查找；多選展開結果會按工程、選擇集合與層級版本快取。直接增刪、重分組及層級正規化都會同步刷新索引，因此大量普通多選不再因 O(n²) UID 查找而與組選產生巨大效能差距。<br>
  Scene nodes and parent-group relationships are resolved through lazy runtime Map indices, while expanded multi-selection results are cached by project, selection set, and hierarchy revision. Direct additions/removals, regrouping, and hierarchy normalization refresh these indices, preventing large ordinary selections from falling into O(n²) UID lookup behavior compared with group selection.
- 視口選取使用透視／正交攝像機射線與三角面深度判定，不依賴螢幕矩形範圍。Locator 使用與畫面固定圖標一致的命中區；從視口選中任何項目後，場景層級會自動捲動並顯示該項。  
  Viewport selection uses perspective/orthographic camera rays and triangle-depth testing rather than screen-space rectangle bounds. Locator uses a hit area matching its fixed on-screen icon; after any item is selected from the viewport, the scene hierarchy automatically scrolls to reveal it.

## 配置註冊表 / Configuration Registry

通用註冊表位於 `src/core/config-registry.js`，應用配置集中在 `src/config/app-config.js`。設定按鈕可直接編輯語言、吸附、對稱、透明度鎖定、投影、網格、線框疊加與外觀。語言切換會立即翻譯目前 DOM，並通過監聽器自動處理之後生成的屬性面板與選單。`application.language` 枚舉合法值為：  
The general registry is located at `src/core/config-registry.js`, while application configuration is centralized in `src/config/app-config.js`. The Settings button directly edits language, snapping, symmetry, alpha lock, projection, grid, wireframe overlay, and appearance. Language switching immediately translates the current DOM and automatically handles subsequently generated property panels and menus through observers. Valid values for the `application.language` enum are:

Shift、Ctrl 與 Shift+Ctrl 的吸附快捷鍵預設採用乘數模式，分別以 `4`、`8`、`64` 乘上基礎細分精度；仍可在吸附設定中改成直接數值模式。  
The Shift, Ctrl, and Shift+Ctrl snapping shortcuts use multiplier mode by default, multiplying the base subdivision precision by `4`, `8`, and `64` respectively; they can still be changed to direct-value mode in the snapping settings.

- `zh-Hant`：繁體中文  
  `zh-Hant`: Traditional Chinese
- `zh-Hans`：简体中文  
  `zh-Hans`: Simplified Chinese
- `en`：English  
  `en`: English

應用模組可直接匯入 `configRegistry`；在渲染器控制台或擴展中也可使用：  
Application modules can import `configRegistry` directly; it can also be used from the renderer console or extensions:

```js
CubeBricks.config.get('application.language');
CubeBricks.config.set('application.language', 'en');
CubeBricks.config.subscribe('application.language', change => console.log(change));
```
