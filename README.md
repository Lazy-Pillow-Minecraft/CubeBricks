# CubeBricks

CubeBricks 是一個以 Cube 與程序化 Shape 為核心的 Minecraft 桌面建模器原型。

## 啟動

```powershell
npm install
npm start
```

若遠端桌面或虛擬機器沒有可用的 GPU 程序，可改用軟體渲染：

```powershell
npm run start:safe
```

只想快速預覽介面時：

```powershell
npm run preview
```

然後打開 `http://127.0.0.1:8765`。

目前版本包含可互動工作區、Cube／Shape／Group／Locator 資料模型、`.cbmodel` 保存、帶巢狀組、逐面 UV 與貼圖的 `.bbmodel` 匯入、屬性編輯、可增減的獨立漸變色卡，以及可保存的語言、吸附和外觀配置。

### 視口操作

- 中鍵拖動：環繞旋轉（垂直 ±90°、水平 360°）
- Shift + 中鍵拖動：平移視圖並更新後續環繞旋轉的中心
- 滾輪：縮放
- `R`：聚焦選中的物體或組
- `Shift + R`：將攝像機重新聚焦到世界中心
- 視口左上角可真正切換透視與正交投影
- 視口右上角可切換線框、體塊、紋理三種渲染模式
- 地面由九宮格主網格與按吸附精度生成的中央細分網格組成，並標有坐標軸及北向

紋理預覽提供實心、Cutout、半透明及三者的 Mipped 抗鋸齒版本；背面剔除、全局陰影和物件陰影均可獨立控制。透視模式使用對數深度以降低大可視距離下的 Z-fighting，Mipped 模式使用螢幕空間抗鋸齒。面亮度由旋轉後的法線配合雙方向光計算。Cube 的原生幾何欄位是 `position`、`size`、`pivot`、`rotation`；舊版 `from/to/origin` 僅在載入時自動遷移。

### 面板與組

- 左側貼圖欄、右側物件屬性、右側場景層級及底部色卡／時間軸欄均可用標題列的 `↗` 各自拆成浮動面板，再用 `↙` 吸回；物件屬性與場景層級不是共享浮窗。
- 停靠狀態可拖動左右欄的內側邊框及底欄上邊框；浮動狀態可拖標題移動，也可拖邊框調整大小。
- 場景層級的 `▰＋` 可建立組；選中物件時會用新組包住該物件，組的樞軸與歐拉角可直接編輯。
- 匯入 `.bbmodel` 時會保留巢狀 outliner 組、組樞軸、組旋轉與組可見性，渲染時按父子順序套用變換。

### 編輯與效能

- 移動、縮放、旋轉工具只使用左鍵操作手柄；中鍵始終留給攝像機。
- 移動和旋轉支援全局、父級、自身三種坐標系；縮放可切換貼合幾何與固定相對長度手柄。
- 場景使用穩定的基礎 Mesh 與獨立選中 Mesh；場景層級只建立可見行，拖動面板時不會重建整份列表。
- 視口選取使用透視／正交攝像機射線與三角面深度判定，不依賴螢幕矩形範圍。

## 配置註冊表

通用註冊表位於 `src/core/config-registry.js`，應用配置集中在 `src/config/app-config.js`。設定按鈕可直接編輯語言、吸附、對稱、透明度鎖定、投影、網格、線框疊加與外觀。`application.language` 枚舉合法值為：

- `zh-Hant`：繁體中文
- `zh-Hans`：简体中文
- `en`：English

應用模組可直接匯入 `configRegistry`；在渲染器控制台或擴展中也可使用：

```js
CubeBricks.config.get('application.language');
CubeBricks.config.set('application.language', 'en');
CubeBricks.config.subscribe('application.language', change => console.log(change));
```
