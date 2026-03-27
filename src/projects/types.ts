/**
 * Project Management — Type Definitions
 *
 * All types for the project management feature.
 */

// ─── Project (meta.json) ───

export type Project = {
  /** 项目唯一标识 (UUID) */
  id: string;
  /** 项目名称（唯一，创建后不可更改） */
  name: string;
  /** 项目目录（绝对路径） */
  directory: string;
  /** 项目文档路径数组 */
  documents: string[];
  /** 项目描述 */
  description?: string;
  /** 创建时间戳 (epoch ms) */
  createdAt: number;
  /** 更新时间戳 (epoch ms) */
  updatedAt: number;
};

// ─── Project Index Entry (index.json — lightweight) ───

export type ProjectIndexEntry = {
  id: string;
  name: string;
  updatedAt: number;
};
