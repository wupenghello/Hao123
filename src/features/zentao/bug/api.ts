/**
 * 禅道 Bug API（建立在 ../shared/http 的请求核心之上）
 *
 * 接口形态见 ../shared/http.ts 顶部说明（PATH_INFO 路由模式）：
 *   我的 Bug  GET  my-bug-<type>-<orderBy>-<pageID>-<recPerPage>.json?zentaosid=
 *   Bug 详情  GET  bug-view-<id>.json?zentaosid=
 */
import { request, toArray, ZentaoApiError, type RequestOptions } from '../shared/http'
import type { ZentaoBug, MyBugData, BugDetailData } from './types'

export const bugApi = {
  /**
   * 我的 Bug my-bug-<type>-<orderBy>-<pageID>-<recPerPage>（PATH_INFO）
   * @param sid     登录态会话 ID
   * @param status  Bug 子页 type：assignedTo（指派给我）/ openedBy（由我创建）/
   *                resolvedBy（由我解决）等
   * @param limit   每页条数（默认 500，一次取全）
   */
  async myBugs(
    sid: string,
    status: 'assignedTo' | 'openedBy' | 'resolvedBy' = 'resolvedBy',
    limit = 500,
    opts?: RequestOptions,
  ): Promise<ZentaoBug[]> {
    const env = await request(`my-bug-${status}-id_desc-1-${limit}`, sid, {}, opts)
    return toArray<ZentaoBug>((env.data as MyBugData)?.bugs)
  },

  /**
   * Bug 详情 bug-view-<id>（PATH_INFO）
   * 返回完整 bug 对象（含重现步骤、解决信息、环境等）。
   * 真实产品/项目名从顶层补全。
   */
  async bugDetail(sid: string, id: string | number, opts?: RequestOptions): Promise<ZentaoBug> {
    const env = await request(`bug-view-${id}`, sid, {}, opts)
    const data = env.data as BugDetailData
    const bug = data?.bug
    if (!bug?.id) throw new ZentaoApiError('parse', '未能获取 Bug 详情')
    if (!bug.productName) {
      const pname =
        data.productName ||
        (typeof data.product === 'object' ? (data.product as { name?: string })?.name : undefined)
      if (pname) bug.productName = pname
    }
    return bug
  },
}

export type BugApi = typeof bugApi
