/**
 * 禅道任务 API（建立在 ../shared/http 的请求核心之上）
 *
 * 接口形态见 ../shared/http.ts 顶部说明（PATH_INFO 路由模式）：
 *   我的任务  GET  my-task-<type>-<orderBy>-<pageID>-<recPerPage>.json?zentaosid=
 *   任务详情  GET  task-view-<id>.json?zentaosid=
 */
import { request, toArray, ZentaoApiError, type RequestOptions } from '../shared/http'
import { ZENTAO_MOCK, mockMyTasks, mockTaskDetail } from '../shared/mock'
import type { ZentaoTask, MyTaskData, TaskDetailData } from './types'

function isTask(v: unknown): v is ZentaoTask {
  return !!v && typeof v === 'object' && 'id' in v && 'name' in v
}

function normalizeTaskList(v: unknown): ZentaoTask[] {
  return toArray<ZentaoTask>(v as Record<string, ZentaoTask> | ZentaoTask[] | undefined).filter(isTask)
}

function extractTasks(data: unknown): ZentaoTask[] {
  const payload = data as MyTaskData & {
    taskStats?: Record<string, ZentaoTask> | ZentaoTask[]
    taskList?: Record<string, ZentaoTask> | ZentaoTask[]
  }
  for (const key of ['tasks', 'taskStats', 'taskList'] as const) {
    const list = normalizeTaskList(payload?.[key])
    if (list.length) return list
  }
  return normalizeTaskList(data)
}

export const taskApi = {
  /**
   * 我的任务 my-task-<type>-<orderBy>-<pageID>-<recPerPage>（PATH_INFO）
   * @param sid     登录态会话 ID
   * @param status  任务子页 type：assignedTo（指派给我）/ openedBy（由我创建）/
   *                finishedBy（由我完成）等
   * @param limit   每页条数（默认 200，一次取全）；禅道默认仅返回首页 20 条，
   *                故必须显式带分页参数，否则列表与计数都只反映第一页。
   */
  async myTasks(
    sid: string,
    status: 'assignedTo' | 'openedBy' | 'finishedBy' = 'assignedTo',
    limit = 200,
    opts?: RequestOptions,
  ): Promise<ZentaoTask[]> {
    if (ZENTAO_MOCK) return mockMyTasks(status)
    const env = await request(`my-task-${status}-id_desc-1-${limit}`, sid, {}, opts)
    return extractTasks(env.data)
  },

  /**
   * 任务详情 task-view-<id>（PATH_INFO）
   * 返回完整 task 对象（含描述、工时、完成信息、关联需求等）。
   * 真实项目名在响应**顶层** project.name（task.projectName 常缺失），这里合并进 task。
   */
  async taskDetail(sid: string, id: string | number, opts?: RequestOptions): Promise<ZentaoTask> {
    if (ZENTAO_MOCK) {
      const t = mockTaskDetail(id)
      if (!t) throw new ZentaoApiError('parse', '未能获取任务详情')
      return t
    }
    const env = await request(`task-view-${id}`, sid, {}, opts)
    const data = env.data as TaskDetailData
    const task = data?.task
    if (!task?.id) throw new ZentaoApiError('parse', '未能获取任务详情')
    if (!task.projectName && data.project?.name) task.projectName = data.project.name
    return task
  },
}

export type TaskApi = typeof taskApi
