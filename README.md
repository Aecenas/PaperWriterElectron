# 信笺写作 Electron

Electron + React + Vite 版个人写作软件。

## 启动

```powershell
.\scripts\Launch-PaperWriter.ps1
```

## 构建安装包

```powershell
cd apps\writer\frontend
npm run build

cd ..\electron
npm run dist
```

安装包输出到 `apps\release`。发布到 GitHub Release 后，应用顶部 `更新` 菜单会通过 GitHub Release 检查新版本。

## 结构

- `apps/writer/frontend`: React 写作界面
- `apps/writer/electron`: Electron 桌面壳、文件读写、PDF 导出
- `scripts`: Windows 启动脚本
