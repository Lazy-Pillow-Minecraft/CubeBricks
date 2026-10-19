# CubeBricks

[繁體中文](#繁體中文) · [English](#english)

## 繁體中文

CubeBricks 是一個面向 Minecraft 模型工作流的桌面建模器。它以 Cube 為基礎幾何，同時提供程序化 Shape、二維／三維 Bezier 曲線、節點、Locator、分組、非破壞式修改器與即時繪畫操作器，目標是在熟悉的 Blockbench 類工作區中完成建模、UV、貼圖與格式轉換。

項目目前處於原型開發階段，重點是建立可擴展的編輯器基礎、穩定的三維交互，以及與 Minecraft／Blockbench 資料語義相符的預覽和導出流程。

## 主要能力

### 建模與場景層級

- Cube 使用「位置 + 尺寸 + 樞軸點 + 歐拉角」描述幾何，允許零尺寸與可選的負尺寸。
- 支援組、Locator、節點、多邊形柱體、正十二面體、足球形截角二十面體、二維 Bezier 與三維 Bezier；程序化 Shape 同樣具有可編輯樞軸點。
- 程序化 Shape 可進入非破壞式細分編輯；對生成 Cube 的調整以覆寫資料保存，不會破壞原 Shape 參數。
- 曲線像組一樣可在場景層級展開，內部節點作為子項顯示和選取，不再把整列節點塞入物件屬性。
- 場景層級支援多選、範圍選擇、拖動排序、拖入組、原位分組、搜索與快速定位；拖動列表項時可用滾輪或靠近上下邊緣自動捲動。
- 可見、鎖定、自動 UV、UV 歸一化與轉換導出標記可在詳細列表中直接管理。

### 修改器

- 修改器由獨立註冊表管理，可按物件類型聲明兼容範圍、默認資料與是否允許重複掛載。
- 組與單一物件各自保存修改器棧；物件屬性使用獨立的「修改器」頁面管理新增、啟用、排序、折疊與刪除。
- 內置對稱修改器支援 XYZ 鏡像、徑向旋轉與曼陀羅模式，可重複掛載並依棧順序處理前一個修改器的結果。
- 每個修改器都可單獨烘焙，把該層結果轉成可編輯內容而不必一次套用整個修改器棧。
- 對稱軸點是所有者內部資料，不會在場景層級生成額外節點；它仍可在主視圖直接選取、移動與旋轉，也不會污染導出結果。
- 對稱預覽重用已有 GPU 幾何；導出 `.bbmodel` 時才展開實例，並修正負行列式變換的繞序與 UV 鏡像。
- 舊版組鏡像及其控制節點會在載入時自動遷移到新修改器結構。

### 即時操作器

- 操作器由獨立註冊表管理，掛載在組或單一物件上；它只處理即時輸入，不生成場景元素，也沒有烘焙流程。
- 內置「繪畫對稱」操作器支援 XYZ、徑向與曼陀羅模式。組操作器作用於全部後代，物件操作器只作用於自身及其生成面。
- 面關聯在背景中分批建立；實際落筆的面會優先處理。匹配同時檢查世界空間四頂點及對應 UV 邊的實際像素長度，避免對稱筆跡被拉伸。
- 幾何、作用域或對稱軸資料變化後會重新核對關聯；整個作用域只做剛體移動或旋轉時可沿用原關聯。
- 在操作器中點擊「在主視圖編輯」，可用場景內軸點標記與移動／旋轉手柄調整對稱中心和方向。同面對稱保留原筆跡與全部頂點映射結果，重疊筆跡沿用單筆透明度。
- 對稱提示包含平面網格、軸線與角度分割射線；徑向與曼陀羅使用相同的提示角度分布，調整中心、方向或配置時即時更新。

### 三維編輯

- 移動、縮放、旋轉與樞軸工具具有三維軸、平面及中心手柄；中鍵始終保留給攝像機。
- 移動與旋轉支援全局、父級和自身參考；自身旋轉可選姿態或歐拉角模式。
- 組縮放與多選縮放共用批量操作；每個元素從自己的初始參數計算尺寸和位置補償。縮放手柄使用參與元素的平均軸方向。
- 樞軸移動會補償幾何位置，只改變旋轉中心而不改變模型外觀。
- 頂點捕捉支援移動、縮放、旋轉及樞軸點操作；可選的「交點顯示」會標出選中元素邊線與周圍幾何的線線／線面交點，交點只能作為目標點。
- 刀具按視線選取最前方 Cube 面，依工程吸附切割幾何並同步切開 UV。
- 主視圖支援單點、框選、Shift 追加與 Ctrl 取消選擇，以及獨立的面選擇模式。

### 視口與渲染

- 透視與正交攝像機可切換並保持視覺尺度連續；支援環繞、平移、縮放與緩動聚焦。
- 提供線框、體塊、紋理與法向顯示模式。
- Minecraft 風格的面陰影由旋轉後法線和雙方向光計算；全局陰影與物件陰影可分別控制。
- 支援實心、Cutout、半透明及其抗鋸齒版本，並提供可選背面剔除。
- 網格、線框、選中覆蓋與輔助線使用獨立抗鋸齒路徑，不受模型表面的 Mipped 設定影響。
- 操作與對稱引導線按三維空間投影，具有最大延伸距離和末端淡出；接近朝向攝像機時會淡化。
- 鎖定物件可使用獨立淡化層和螢幕空間漸變區域，不會改寫材質本身的透明度。
- 一般視圖與 X／Y／Z 軸向視圖可分別導入多張參考圖；軸向視圖固定使用正交投影，同軸再次點擊可切換正負方向，中鍵專用於平移。
- 可啟用獨立的玩家尺寸與姿態參考，使用內置皮膚或在設定中替換自定義紋理；參考不參與選取、工程保存與模型導出。
- 在主視圖空白處右鍵可截屏模型：屏幕截圖只保留目前視窗內的模型，離屏渲染會自動框住可見模型；兩者均使用透明背景，並可預覽、複製或另存為 PNG。

### UV 與貼圖

- Cube 可使用箱型 UV 或逐面 UV，每個面可獨立指定貼圖、旋轉、鏡像與剔除狀態。
- 貼圖提供基礎圖層：新增、命名、選取、排序、顯示、透明度與刪除；繪畫落在當前圖層，模型顯示合成結果。圖層資料隨 `.cbmodel` 保存。
- 貼圖本身可切換默認、平鋪、動畫三種模式；動畫目前為佔位。面各自保留普通 UV 和平鋪的單片寬高、X／Y 偏移，換貼圖不清除另一套資訊。
- 拖動列表貼圖時顯示鼠標縮略圖，可直接賦予模型的面；多選時同時賦予所有所選元素的同方向面。平鋪渲染單片快取最高 1024 × 1024px，超出需求的面僅在渲染中拆片，不改動模型、導出結構或模板烘焙。
- 元素顯示色與一般顏色欄可使用方形、圓形或三角形 HSV 彈窗；BBModel 的 Cube 調色板索引會轉換為對應顯示色，導出時選取最接近的標準色。
- 貼圖窗口支援多面選取、UV 移動與拉伸、吸附、聚焦、縮放和平移。
- UV 預覽只渲染選中內容，可選自動旋轉、面向配色、面旋轉及鏡像標記；繪畫時同步使用最新畫布，停用時停止渲染排程。
- 可建立紋理模板、純色模板或空白貼圖。模板生成會按工程基礎吸附分辨率歸一化尺寸，為非零邊長保留至少 1px，並可清理零面積無效面；UV 使用緊密的矩形裝箱排列，畫布可選 2 冪或指定倍數。
- 繪畫模式可直接在二維貼圖、Cube 與程序化 Shape 表面作畫，提供畫筆、直線、矩形、橢圓、油漆桶、漸變與取色器；除漸變外，繪製工具可切換擦除模式，並各自記憶尺寸與透明度。鎖定透明度與忽視全透明像素是獨立開關；不同面可引用不同貼圖。
- 繪畫時可按住 Alt 臨時切換至取色器，鬆開後立即返回原本工具；臨時切換不會清除尚未完成的漸變選點。
- 畫筆支援方形／圓形筆尖、抗鋸齒、透明度與三維跨面連續筆畫。筆刷深度會沿 Cube 的實際鄰面及 UV 朝向延伸，疊加繪製只同步處理最前方完全重合的面，不會穿透模型。
- 漸變工具提供面漸變與體漸變；兩個取樣點只決定方向，顏色會映射至整個面或整個 Cube。雙色模式透過兩個色槽選擇右側選色器的編輯目標，且兩端透明度可獨立調整；也可改用目前選中色卡的多色漸變。
- 選色器提供方形、圓形與三角形 HSV 操作。三角模式使用獨立色相環與重心色域，明度黑點收斂於單一頂點，顯示與實際取色共用同一套換算；常用的近期顏色顯示在選色器下方。
- 色卡面板支援逐行選取、插入、刪除與拖動排序；新建色卡保持空白，每一行可獨立使用離散色或連續漸變。
- 繪畫模式不顯示編輯選中高亮。場景層級保留索引、選取、展開、聚焦及可見／鎖定切換，禁止新建、刪除、拖動重排及幾何操作，也不允許進入 Shape 細分編輯；桌面版會在項目操作記錄中保存繪畫變更。
- 全部剔除的 Cube 會被移除；單面剔除會同時取消該面的主視圖拾取，但仍可在 UV 預覽中處理。

### 工作區與配置

- 左、右、底部面板使用統一停靠物件，可取下、靠近自動吸附、重新排序、折疊及調整整欄寬度。
- 物件屬性按「基礎／外觀／UV／修改器／操作器」分類，避免長頁面持續向下堆疊。
- 多項目以頁籤方式同時打開，可切換、拖動排序、編輯項目信息或關閉。
- 關閉桌面程式時會列出已開啟項目，預設全部勾選保留；取消勾選的工作目錄會在確認後移除。下次啟動會恢復保留的頁籤。
- 配置註冊表統一管理繁體中文、簡體中文、英語、外觀、視圖、吸附與工作區選項。
- 模型格式使用可擴展註冊表，格式可提供自己的初始工程資料、吸附基準、貼圖尺寸與能力標記。Java 方塊／物品可在項目信息中選擇三檔旋轉規則：1.9–1.21.5 為 22.5° 倍數單軸、1.21.6–1.21.10 為自由角度單軸、1.21.11+ 不限角度與軸數；該格式使用逐面 UV。模組版實體使用箱型 UV、整數 Cube 尺寸與組旋轉，Cube 自身不旋轉。

## 操作指南

### 建立與管理項目

1. 點擊頂部的「新建」，選擇模型格式及其初始參數。
2. 使用項目頁籤切換同時打開的工程；頁籤可拖動排序，右鍵可編輯項目信息，中鍵或叉號可關閉。
3. 在場景層級上方建立 Cube、Shape、Locator 或組。選中元素後建立的新內容會依目前層級插入。
4. `Ctrl+S` 保存，`Ctrl+Shift+S` 另存；導出時可依副檔名選擇 `.cbmodel` 或 `.bbmodel`。
5. 關閉程式時，勾選要在下次開啟時恢復的項目；若取消勾選，確認關閉後會刪除該項目的工作記錄。

### 視角與選取

| 操作 | 結果 |
| --- | --- |
| 中鍵拖動 | 在一般視圖環繞攝像機；在 X／Y／Z 軸向視圖平移 |
| `Shift` + 中鍵拖動 | 平移一般視圖攝像機 |
| 滾輪 | 縮放視圖 |
| `R` | 聚焦選中內容 |
| `Shift+R` | 回到場景中心 |
| 點擊輪盤軸 | 進入對應的正交軸向視圖；再次點擊反轉方向 |
| 拖動三軸輪盤 | 退出軸向視圖並返回一般視圖 |
| 左鍵物件 | 單選；點擊空白背景清空選擇 |
| 左鍵拖框 | 框選；`Shift` 追加，`Ctrl` 從目前選擇中移除 |
| 右鍵物件或列表項 | 打開共用的物件操作選單 |

### 編輯工具

| 快捷鍵 | 工具 |
| --- | --- |
| `1` | 移動 |
| `2` | 縮放 |
| `3` | 旋轉 |
| `4` | 移動樞軸 |
| `5` | 頂點捕捉 |
| `6` | 刀具 |
| `7` | 面選擇 |

- 手柄只接受左鍵；中鍵始終交給攝像機。拖動軸、平面或中心手柄可執行單軸、雙軸或三軸操作。
- 移動與旋轉可在全局、父級和自身坐標系間切換；多選時可選擇統一執行或分別執行。
- 選中組或多個元素後，使用縮放工具批量調整；手柄按參與元素的平均方向顯示，位置補償對各元素獨立計算。
- 吸附精度由工程格式與設定共同決定。`Shift`、`Ctrl` 及兩者同時按下可套用各自的微調倍率。
- 樞軸工具和樞軸頂點捕捉只改變旋轉中心，會補償物件參數以保持幾何外觀不動。
- 使用頂點捕捉時可開啟「交點顯示」；直角菱形代表選中元素的邊線與周圍物件的三維交點，可選作第二個目標點，不能作為起始點。
- `Ctrl+Z` 撤銷，`Ctrl+Shift+Z` 重做；複製、剪切、貼上與原位複製分別使用 `Ctrl+C`、`Ctrl+X`、`Ctrl+V`、`Ctrl+D`。

### UV 與貼圖

1. 在貼圖列表建立或導入貼圖，再把貼圖拖到主視圖的 Cube 面上。多選 Cube 時會按放下位置所指的面向批量指定。
2. 進入 UV 編輯模式後，可在貼圖窗口選擇一個或多個面，拖動 UV 框或邊緣調整位置和尺寸。
3. `Ctrl` + 滾輪縮放貼圖；滾輪縱向捲動，`Shift` + 滾輪橫向捲動，中鍵可自由平移。
4. 貼圖窗口獲得焦點後，`R` 聚焦選中 UV，`Shift+R` 回到預設貼圖視圖。
5. UV 可以超出貼圖範圍以保留特殊模型資料，但主動拖動不會把 UV 推出有效範圍。

### 繪畫模式

| 快捷鍵 | 工具 |
| --- | --- |
| `B` | 畫筆 |
| `L` | 直線 |
| `M` | 矩形 |
| `O` | 橢圓 |
| `G` | 油漆桶 |
| `J` | 漸變 |
| `I` | 取色器 |
| 按住 `Alt` | 臨時取色；鬆開恢復原工具 |

- 畫筆可直接在二維貼圖、三維模型面或三維視圖的空白處起筆；從空白處拖入已分配貼圖的面時才開始落色，離開模型後再進入仍屬同一筆。跨面筆畫維持同一次筆畫的透明度與連續性；全程只經過空白處不會改動貼圖。
- 未分配貼圖的面不會在繪畫時自動綁定目前貼圖；三維視圖會提示先指定貼圖並保持模型資料不變。
- 「筆刷深度」控制筆跡碰到 Cube 邊緣時向相鄰面的延伸像素數；「疊加繪製」只同步處理最前方完全重合的面。
- 開啟「忽視全透明」時，三維繪畫會穿過完全透明的貼圖像素，選擇射線上第一個可繪畫的有色像素；單筆擦除以起筆時的透明度判定命中，避免擦開前層後繼續擦穿後層。
- 面漸變要求兩點位於同一面；體漸變要求兩點位於同一 Cube。兩點只定義方向，漸變會覆蓋完整目標。
- 雙色漸變先點擊第一色或第二色色槽，再在右側選色器調色；兩端 Alpha 可獨立設定。啟用「使用色卡」後會改用目前選中色卡的全部顏色。
- 色卡行可獨立選擇離散或漸變模式，並支援選中、插入、刪除及拖動重排顏色。
- 繪畫模式中的場景層級可查找、選取、聚焦及切換元素可見性／鎖定；修改模型幾何需回到編輯模式。畫筆等非漸變工具直接使用右側選色器的當前顏色。桌面版的 `Ctrl+Z`／`Ctrl+Shift+Z` 依當前項目的操作記錄撤銷／重做，包含繪畫與貼圖指派。

### 使用繪畫對稱

1. 在編輯模式選中組或單一物件，打開物件屬性的「操作器」頁面，新增「繪畫對稱」。
2. 選擇 XYZ、徑向或曼陀羅模式；XYZ 可同時啟用多軸，其餘模式可設定數量及 360° 均分或限制角度範圍。
3. 點擊「在主視圖編輯」，使用移動／旋轉手柄調整軸點；也可直接輸入位置和旋轉。調整完成後結束軸點編輯。
4. 先為需要繪製的面分配貼圖，再切換繪畫模式。三維繪畫會依面關聯同步到對稱面；頂點或對應 UV 邊長不匹配的面不會強行映射。
5. 組操作器涵蓋其後代，單一物件操作器涵蓋自身的面；符合條件的同面鏡像、徑向與曼陀羅映射會保留原筆跡並一起繪製。操作器保存在工程中，不需要烘焙。

### 面板與視窗

- 拖動停靠面板標題可將面板取下；靠近左、右或底部停靠區時會自動吸附。
- 同一停靠邊的面板共享寬度，拖動任一面板邊界會調整整欄；浮動面板可從邊或角調整大小。
- 點擊面板外側的三角形可折疊或展開整個停靠邊。帶熱點聚焦的面板在交互後會顯示淡色焦點框。
- 在輸入框、選單或文字編輯區內，字母和數字快捷鍵不會觸發工具切換。
- 拖動場景元素、貼圖或色卡時，可使用滾輪或把指標移到列表上下邊緣繼續捲動。

## 文件格式

- `.cbmodel`：CubeBricks 工程格式，以 ZIP 保存可編輯的 Shape、曲線、修改器、操作器、層級、貼圖和工程設定。每個工程使用固定 UUID 識別；桌面版在可配置的工作目錄記錄項目內的全局操作序列與各元素局部歷史。參考圖按內容保存一份並由歷史記錄引用；貼圖變更保存可雙向套用的像素差異，以便撤銷、重做和異常關閉後恢復。
- 工作記錄會保存貼圖分組、拖貼圖到模型面的批量指派，以及撤銷後實際走過的重做分支。多開桌面程式時，同一工作項目只允許一個視窗寫入；遇到缺失或損壞的操作快照時會停止跨越該記錄，保留目前模型狀態。
- 打開已保存的工程時，會比對同路徑工作記錄的 UUID 與歷史：一致時沿用，文件或工作副本較新時按歷史關係處理；歷史分歧時由用戶選擇另開或取代工作副本，不會直接改寫原始文件。
- `.bbmodel`：支援 Blockbench 模型匯入與導出；程序化物件和修改器會在導出時展開為兼容的 Cube／組資料。
- 內置工程類型包含通用模型、圖像以及多種 Minecraft Java、Bedrock、模組實體、皮膚與 GeckoLib 類型；尚未完成的編輯器類型會明確標記為佔位。

### 工作記錄恢復

如果出現「項目狀態文件損壞，且找不到上一個完成狀態」，表示工作目錄中的 `current_state` 和 `current_state.previous` 都無法提供有效的恢復狀態；這不代表已保存的 `.cbmodel` 或 `.bbmodel` 一定損壞。先保留並備份整個工作目錄，不要手動刪除其中的交易、元素或貼圖文件；可先嘗試正常打開已保存的工程。未保存的內容需要檢查該工作目錄，不能只靠重新按「恢復」保證找回。

## 啟動

需要 Node.js。首次使用先安裝依賴：

```powershell
npm install
```

啟動桌面版：

```powershell
npm start
```

遠端桌面或虛擬機器無法正常使用 GPU 時：

```powershell
npm run start:safe
```

只預覽網頁介面：

```powershell
npm run preview
```

然後打開 `http://127.0.0.1:8765/`。

## 驗證

```powershell
npm run check
npm run test:config
npm run test:model
npm run test:render
npm run test:operations
npm run test:journal
```

## Windows 單文件打包

可直接雙擊根目錄的 `build-portable.bat`。它會檢查原始碼、執行測試，然後在 `dist` 目錄生成免安裝的單一執行文件：

```text
dist/CubeBricks-<version>-portable.exe
```

也可以在終端執行：

```powershell
npm run dist:portable
```

首次打包需要網路下載依賴與 Electron 打包資源，之後會使用本機快取。

## 項目結構

```text
electron/                 Electron 主程序與桌面整合
src/app.js                編輯器交互與界面狀態
src/model.js              工程資料、幾何、修改器／操作器實例與格式轉換
src/render/               WebGL 場景與 UV 預覽渲染
src/core/                 配置、格式、修改器、操作器等通用註冊表
src/config/               內置配置、模型格式、修改器與操作器定義
src/ui/                   停靠窗口等通用界面組件
scripts/                  預覽服務、測試與輔助工具
```

CubeBricks 的核心方向是把編輯器能力拆成可註冊、可組合的模組，同時保留 Minecraft 模型需要的像素精度、UV 語義與 Blockbench 交換能力。

---

## English

CubeBricks is a desktop model editor designed for Minecraft-oriented workflows. Cube geometry remains its foundation, while procedural shapes, 2D and 3D Bezier curves, nodes, locators, groups, non-destructive modifiers, and real-time painting operators extend the editor beyond basic box modeling. Its goal is to bring modeling, UV editing, texturing, and format conversion into a familiar Blockbench-style workspace.

The project is currently an evolving prototype focused on an extensible editor architecture, dependable 3D interaction, and preview/export behavior that follows Minecraft and Blockbench data semantics.

## Core features

### Modeling and scene hierarchy

- Cubes use position, size, pivot, and Euler rotation to describe geometry. Zero-sized dimensions are supported, and negative dimensions are optional.
- Groups, locators, nodes, polygon columns, dodecahedrons, truncated-icosahedron footballs, and 2D/3D Bezier curves are supported. Procedural shapes have editable pivots as well.
- Procedural shapes support non-destructive subdivision editing. Changes to generated cubes are stored as overrides without destroying the original shape parameters.
- Curves can be expanded in the scene hierarchy like groups, with their nodes displayed and selected as children instead of being placed in a long property list.
- The hierarchy supports multi-selection, range selection, drag reordering, group nesting, in-place grouping, search, and animated navigation. While dragging list items, use the wheel or move near the top or bottom edge to scroll.
- Visibility, locking, automatic UV, UV normalization, and conversion-export flags can be managed directly from the detailed hierarchy view.

### Modifiers

- Modifiers are managed by an extensible registry that declares compatible object types, default data, and whether a modifier can be stacked more than once.
- Groups and individual objects keep separate modifier stacks. A dedicated Modifiers property page handles creation, enabling, ordering, collapsing, and deletion.
- The built-in symmetry modifier supports XYZ mirroring, radial repetition, and mandala symmetry. Multiple instances can be stacked, with each modifier processing the previous result.
- Each modifier can be baked independently, turning that layer into editable content without applying the entire stack.
- Symmetry anchors are internal owner data rather than extra hierarchy nodes. They remain directly selectable, movable, and rotatable in the viewport without polluting exports.
- Symmetry previews reuse existing GPU geometry. Instances are expanded only when exporting `.bbmodel`, including winding and mirrored-UV correction for negative-determinant transforms.
- Legacy group symmetry data and control nodes are migrated to the modifier structure when loaded.

### Real-time operators

- Operators use a separate extensible registry and can be attached to groups or individual objects. They process live input only, create no scene objects, and have no bake action.
- The built-in Paint Symmetry operator supports XYZ reflection, radial repetition, and mandala symmetry. Group operators cover all descendants; object operators cover that object and its generated faces.
- Face relationships are built incrementally in the background, while a face receiving a live stroke is promoted immediately. Matching checks both the four world-space vertices and the corresponding UV edge lengths in real pixels, preventing scaled symmetry strokes.
- Geometry, scope, or symmetry-axis changes trigger relationship validation. A rigid transform of the complete scope can reuse the existing mapping.
- Click the operator's viewport-edit button to adjust its center and orientation with the embedded anchor marker and move/rotate gizmos. Self-symmetry preserves the original stroke and every distinct vertex mapping; overlapping strokes retain single-stroke opacity.
- Symmetry guides include plane grids, axes, and angular rays. Radial and mandala modes share the same guide-angle distribution; guides update as the center, orientation, or settings change.

### 3D editing

- Move, scale, rotate, and pivot tools provide 3D axis, plane, and center handles. The middle mouse button is always reserved for the camera.
- Move and rotate support global, parent, and local reference spaces. Local rotation offers pose and Euler modes.
- Groups and multi-selected elements share batch scaling. Each element calculates its size and position compensation from its own starting parameters, and scale gizmos use the participating elements' average axis directions.
- Moving a pivot compensates the geometry position, changing only the rotation center without changing the visible model.
- Vertex snapping supports move, scale, rotate, and pivot operations. Optional intersection markers show where selected edges meet nearby edges or faces; these points can only be snap targets.
- The knife selects the frontmost cube face along the view ray, cuts at the project snapping step, and splits UVs with the geometry.
- The viewport supports click selection, marquee selection, Shift-add, Ctrl-remove, and a dedicated face-selection mode.

### Viewport and rendering

- Perspective and orthographic cameras preserve their apparent scale when switching and support orbiting, panning, zooming, and eased focus transitions.
- Wireframe, solid, textured, and normal display modes are available.
- Minecraft-style face shading is calculated from transformed normals and two directional lights. Global and per-object shading can be controlled separately.
- Solid, cutout, and translucent rendering are supported, together with antialiased variants and optional back-face culling.
- Grids, wireframes, selection overlays, and guides use an independent antialiasing path and are not affected by the model-surface Mipped option.
- Transform and symmetry guide lines are projected from 3D space, have a maximum length, and fade at their ends. They also fade when nearly aligned with the camera direction.
- Locked objects can use a separate fade layer and a screen-space pointer gradient without modifying material transparency.
- General, X, Y, and Z views can each contain multiple reference images. Axis views are always orthographic; clicking the same axis again reverses direction, and middle-drag always pans.
- An independent player scale and pose reference can use the bundled skin or a custom texture from Settings. It is excluded from selection, project files, and model exports.
- Right-click empty viewport space to capture the model. Screen capture keeps only model pixels inside the current view; offscreen rendering frames the visible model. Both have transparent backgrounds and can be previewed, copied, or saved as PNG.

### UV and texturing

- Cubes support box UV and per-face UV. Every face can independently select a texture, rotation, mirroring, and culling state.
- Basic texture layers support creation, naming, selection, ordering, visibility, opacity, and deletion. Painting targets the active layer, while the model displays the composite. Layer data is saved in `.cbmodel` projects.
- Texture assets switch between default, tiled, and animation modes; animation is currently a placeholder. Faces retain both ordinary UVs and tile dimensions/offsets when textures or modes change.
- Drag textures from the list with a cursor thumbnail to assign them to model faces. Multi-selection assigns the same face direction across selected elements. Tiled render caches are capped at 1024 × 1024px per piece; larger faces are split only for rendering, without changing model data, export structure, or template baking.
- Element display colors and ordinary color fields can use square, circular, or triangular HSV popups. BBModel cube palette indices are converted to display colors; export selects the nearest standard palette color.
- The texture panel supports multi-face selection, UV movement and resizing, snapping, focus, zoom, and pan.
- UV Preview renders only selected content and can show automatic rotation, face-direction colors, face rotation, and mirror markers. Painting uses the latest live canvas; disabling the panel stops its render scheduling.
- Texture templates, solid-color templates, and blank textures can be created. Template generation normalizes sizes against the project base snapping resolution, preserves at least one pixel for non-zero edges, can remove zero-area faces, packs UV rectangles tightly, and supports power-of-two or custom-multiple canvases.
- Paint mode works directly on 2D textures, cubes, and procedural shape surfaces. Brush, line, rectangle, ellipse, and fill each offer an erase mode and remember their own size and opacity. Alpha lock and ignore fully transparent pixels are separate options. Gradient and eyedropper remain available, and each face may reference a different texture.
- Painting never assigns the active texture to an untextured face implicitly. The 3D viewport reports the missing assignment and leaves model data unchanged until a texture is explicitly attached.
- Holding Alt temporarily activates the eyedropper and releasing it restores the previous tool. Temporary switching preserves an unfinished gradient selection.
- Brushes support square and round tips, antialiasing, opacity, and continuous 3D strokes across faces. Brush depth follows actual shared cube edges and each neighboring face's UV orientation. Coincident painting affects exactly overlapping surfaces at the first eligible depth. With "ignore fully transparent" enabled, 3D paint can reach colored pixels behind transparent faces; a stroke keeps its original alpha hit map so erasing the front face cannot tunnel into the next layer.
- Face and volume gradients map across the complete face or cube. The two picked points define direction only. In two-color mode, two stop buttons select which endpoint is edited by the right-side picker, and each endpoint has independent alpha; the selected palette can be used for multi-color gradients instead.
- The color picker offers distinct square, circular, and triangular HSV controls. Triangle mode uses a separate hue ring and barycentric color field whose black value converges at one vertex, with display and sampling sharing the same conversion. Recent colors appear below the picker.
- Palette rows support selection, insertion, deletion, and drag ordering. New rows start empty, and each row independently supports discrete colors or a continuous gradient.
- Paint mode hides edit-selection highlighting. The hierarchy provides indexing, selection, expansion, focus, and visibility/lock toggles, while creation, deletion, reordering, geometry operations, and shape subdivision editing are disabled. The desktop app records painting changes in the project operation journal.
- Culling every face removes the cube. A culled individual face is no longer pickable in the main viewport but remains available in UV Preview.

### Workspace and configuration

- Left, right, and bottom panels use a shared docking object model. Panels can detach, auto-dock when nearby, reorder, collapse, and resize their entire dock column.
- Object properties are split into Basic, Appearance, UV, Modifiers, and Operators pages instead of one continuously stacked panel.
- Multiple projects can remain open as tabs that support selection, drag ordering, project-information editing, and closing.
- On exit, the desktop app lists open projects with every tab checked for retention by default. Unchecking a tab removes its working directory after confirmation; retained tabs reopen at the next launch.
- A configuration registry manages Traditional Chinese, Simplified Chinese, English, appearance, viewport, snapping, and workspace settings.
- Model formats use an extensible registry and may provide their own initial project data, snapping baseline, texture size, and capability flags. Java Block/Item offers three rotation rules in Project Information: 1.9–1.21.5 uses single-axis 22.5° increments; 1.21.6–1.21.10 allows any angle on one axis; 1.21.11+ allows unrestricted angles and axes. It uses per-face UVs. Modded Entity uses box UVs, integer cube dimensions, and group rotation rather than cube rotation.

## Operation guide

### Creating and managing projects

1. Click **New** in the top bar and choose a model format and its initial parameters.
2. Use project tabs to switch between open projects. Tabs can be reordered by dragging, edited from the context menu, and closed with the middle mouse button or close icon.
3. Create cubes, shapes, locators, or groups from the controls above the scene hierarchy. New content is inserted relative to the current hierarchy selection.
4. Use `Ctrl+S` to save and `Ctrl+Shift+S` to save as. Export chooses `.cbmodel` or `.bbmodel` from the selected or typed extension.
5. When exiting, keep checked the projects you want to reopen. Confirming with a tab unchecked removes that project's working history.

### Camera and selection

| Input | Result |
| --- | --- |
| Middle-drag | Orbit in the general view; pan in X/Y/Z axis views |
| `Shift` + middle-drag | Pan the general-view camera |
| Mouse wheel | Zoom the view |
| `R` | Focus the current selection |
| `Shift+R` | Return to the scene origin |
| Click an axis-widget axis | Enter its orthographic axis view; click it again to reverse direction |
| Drag the axis widget | Leave an axis view and return to the general view |
| Left-click an object | Select it; click the empty background to clear the selection |
| Left-drag a marquee | Box-select; hold `Shift` to add or `Ctrl` to remove |
| Right-click an object or hierarchy item | Open the shared object context menu |

### Editing tools

| Shortcut | Tool |
| --- | --- |
| `1` | Move |
| `2` | Scale |
| `3` | Rotate |
| `4` | Move pivot |
| `5` | Vertex snap |
| `6` | Knife |
| `7` | Face select |

- Gizmos accept only the left mouse button; the middle button always controls the camera. Axis, plane, and center handles perform one-, two-, and three-axis operations.
- Move and rotate can use global, parent, or local coordinates. Multi-selection offers unified and per-object execution.
- Select a group or multiple elements and use Scale for batch resizing. Gizmos follow the participating elements' average directions, and position compensation is calculated independently for each element.
- Snapping is defined by both the project format and user settings. `Shift`, `Ctrl`, and both together apply their configured fine-adjustment multipliers.
- Pivot movement and pivot vertex snapping change only the rotation center and compensate object parameters so the visible geometry stays fixed.
- Enable **Show Intersections** in Vertex Snap to mark 3D edge/edge and edge/face intersections with square diamonds. They can be picked as the second, target point, but not as a source point.
- `Ctrl+Z` undoes and `Ctrl+Shift+Z` redoes. Copy, cut, paste, and duplicate in place use `Ctrl+C`, `Ctrl+X`, `Ctrl+V`, and `Ctrl+D`.

### UV and textures

1. Create or import a texture in the texture list, then drag it onto a cube face in the main viewport. With multiple cubes selected, the drop direction is assigned to all of them.
2. In UV Edit mode, select one or more faces in the texture panel and drag UV rectangles or their edges to move and resize them.
3. Use `Ctrl` + wheel to zoom the texture, the wheel to scroll vertically, `Shift` + wheel to scroll horizontally, and middle-drag to pan freely.
4. When the texture panel has focus, `R` focuses selected UVs and `Shift+R` restores the default texture view.
5. UVs may remain outside the texture bounds for compatibility with unusual model data, but ordinary dragging does not push them out of range.

### Paint mode

| Shortcut | Tool |
| --- | --- |
| `B` | Brush |
| `L` | Line |
| `M` | Rectangle |
| `O` | Ellipse |
| `G` | Fill |
| `J` | Gradient |
| `I` | Eyedropper |
| Hold `Alt` | Temporary eyedropper; release to restore the previous tool |

- A brush stroke can begin on the 2D texture, a 3D model face, or empty viewport space. Dragging from empty space onto a textured face begins painting there; leaving and re-entering the model remains the same stroke. Cross-face strokes keep continuous opacity and history, while a stroke that never touches a face changes nothing.
- Brush Depth controls how many pixels continue onto neighboring faces when a stroke reaches a cube edge. Coincident Painting affects only exactly overlapping frontmost faces.
- A face gradient requires both points on one face; a volume gradient requires both points on one cube. The points define direction only, and the gradient covers the complete target.
- In two-color mode, click the first or second stop button and edit that stop in the right-side picker. Each stop has independent alpha. Enabling **Use Palette** switches to every color in the selected palette row.
- Palette rows independently support discrete or gradient display and allow color selection, insertion, deletion, and drag reordering.
- The hierarchy in Paint mode can find, select, and focus content or toggle an element's visibility and lock state. Return to Edit mode to change model geometry. Non-gradient paint tools use the current color from the right-side picker. In the desktop app, `Ctrl+Z` and `Ctrl+Shift+Z` follow the active project's operation journal, including painting and texture assignment.

### Using Paint Symmetry

1. In Edit mode, select a group or individual object, open its Operators property page, and add Paint Symmetry.
2. Choose XYZ, radial, or mandala symmetry. XYZ supports multiple enabled axes; the other modes provide a count and either full-circle distribution or a limited angular range.
3. Click the viewport-edit button and adjust the anchor with Move or Rotate, or enter its position and rotation directly. Finish anchor editing when done.
4. Assign textures to the faces you intend to paint, then switch to Paint mode. Painting in the 3D viewport propagates through face relationships; faces with mismatched vertices or corresponding UV edge lengths are excluded.
5. Group operators cover descendants, while object operators cover their own faces. Eligible self-reflection, radial, and mandala mappings preserve the original stroke alongside every mapped result. Operators are saved in the project and require no baking.

### Panels and windows

- Drag a dock panel header to detach it. Moving it near the left, right, or bottom docking area attaches it automatically.
- Panels on one dock edge share a width. Resizing any panel edge changes the column; floating panels resize from edges and corners.
- Use the outward-facing triangle to collapse or expand a dock edge. Panels with hotspot focus show a subtle focus outline after interaction.
- Letter and number shortcuts do not switch tools while an input, select menu, or editable text field has focus.
- While dragging a scene element, texture, or palette color, use the wheel or move the pointer near a list edge to continue scrolling.

## File formats

- `.cbmodel`: a ZIP-based CubeBricks project preserving editable shapes, curves, modifiers, operators, hierarchy, textures, and settings. Each project has a stable UUID. The desktop app keeps a configurable working directory with a project-scoped operation sequence and per-element history. Reference images are stored once by content and referenced by history entries; texture edits use reversible pixel deltas for undo, redo, and crash recovery.
- The operation journal also preserves texture folders, bulk face assignment by dragging textures onto a model, and the redo branch actually traversed by the user. Only one app window may write a given working project at a time. If an operation snapshot is missing or damaged, navigation stops at that boundary and preserves the current model.
- Opening a saved project compares its UUID and history with same-path working copies. Matching histories reuse the appropriate working state; diverged histories prompt the user to open separately or replace the working copy without silently overwriting the source file.
- `.bbmodel`: Blockbench import and export. Procedural objects and modifiers are expanded into compatible cube/group data during export.
- Built-in project types cover generic models, images, and several Minecraft Java, Bedrock, modded-entity, skin, and GeckoLib workflows. Editors that are not implemented yet are clearly marked as placeholders.

### Recovering a working journal

If recovery reports that the project state file is damaged and no previous completed state exists, neither `current_state` nor `current_state.previous` provides a valid recovery point. This does not necessarily mean a saved `.cbmodel` or `.bbmodel` is damaged. Keep a backup of the complete working directory rather than deleting its transaction, element, or texture files, and try opening the saved project normally. Recovering unsaved work requires examining that directory; retrying **Recover** alone cannot guarantee it.

## Running

Node.js is required. Install dependencies once:

```powershell
npm install
```

Start the desktop application:

```powershell
npm start
```

If GPU rendering is unavailable in a remote desktop or virtual machine:

```powershell
npm run start:safe
```

To preview only the web interface:

```powershell
npm run preview
```

Then open `http://127.0.0.1:8765/`.

## Validation

```powershell
npm run check
npm run test:config
npm run test:model
npm run test:render
npm run test:operations
npm run test:journal
```

## Windows single-file build

Double-click `build-portable.bat` in the repository root. It checks the source, runs the test suite, and creates a portable single executable in `dist`:

```text
dist/CubeBricks-<version>-portable.exe
```

The same build can be started from a terminal:

```powershell
npm run dist:portable
```

The first build requires network access to download dependencies and Electron packaging resources. Later builds reuse the local cache.

## Project structure

```text
electron/                 Electron main process and desktop integration
src/app.js                Editor interaction and UI state
src/model.js              Project data, geometry, modifier/operator instances, and format conversion
src/render/               WebGL scene and UV Preview rendering
src/core/                 Shared registries for configuration, formats, modifiers, and operators
src/config/               Built-in configuration, model formats, modifier definitions, and operator definitions
src/ui/                   Shared UI components such as dockable panels
scripts/                  Preview server, tests, and helper tools
```

CubeBricks is built around registrable, composable editor capabilities while preserving the pixel precision, UV semantics, and Blockbench interchange required by Minecraft model workflows.
