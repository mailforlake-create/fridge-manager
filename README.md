# Fridge Manager

Fridge Manager 是一个基于 React + Vite 的家庭库存管理应用，用于记录冰箱食材、日用品、购物历史和就餐历史。

## 功能概览

- 冰箱库存管理（食材数量、到期日、位置）
- 日用品库存管理
- 购物历史记录与回填库存
- 就餐历史与票据/菜品图片管理
- Supabase 数据存储与 Edge Function 代理

## 本地开发

```bash
npm install
npm run dev
```

## 常用脚本

- `npm run dev`：启动开发服务器
- `npm run build`：构建生产包
- `npm run lint`：运行 ESLint
- `npm run backup`：导出 Supabase 数据
- `npm run restore`：从备份恢复数据

## 备份与恢复

- 备份文件默认输出到 `dataBackup/` 目录。
- 恢复前请确认目标环境，恢复脚本会清空相关表数据。

## 技术栈

- React 19
- Vite 8
- Supabase
- React Router
