// use-request旨简化接口调用时产生的一些重复且繁琐的状态管理，如每次使用接口时都需要声明：isLoading、data等状态。基于vue3提供一个hook用于包装现有接口，但不限于各种请求库或原生请求。
// use-request提供以下功能，同时确保静态类型检查：
// 1.业务数据提取：如一般项目接口响应类型可能具有一个公共的结构：{ code: number, data: ... }、或使用了一些请求库如axios：AxiosResponse，或两者同时存在，而在业务页面中只关心业务数据data，从而提供一个选项传入键名(受制于ts使用工厂函数则无法提供静态类型检查，从而使用传入键名方式实现)从固定结构中提取这个业务数据。
// 2.请求参数转换：页面参数结构/类型可能与接口参数结构/类型不一致，提供一个选项传入工厂函数转换这些参数为接口需要的参数。
// 3.响应数据转换：页面参数结构/类型可能与接口响应数据类型接口/类型不一致，提供一个选项传入工厂函数转换接口响应的数据为data。
// 4.默认数据：在未请求时可能需要一个默认数据，提供一个选项载入默认数据。
// 5.请求时机控制：在一些ui中可能需要使用进入ui立即就请求数据如：展示型ui，而一些表单型ui则需要特定情况下才触发请求，以供immediate参数控制是否立即触发，提供execute方法用于手动执行请求。
// 6.自动请求控制：在一些情况下可能需要根据数据变化自动触发请求而不需要额外编写触发代码，如：分页数据变化自动触发请求，请求参数传入Ref或Reactive类型将自动检测参数变化自动执行请求，提供watchDeep观察深度选项。
// 7.状态变化回调：

// useRequestWrap提供以下选项：
// extractData // 业务数据提取（每次执行请求后提取业务数据到data状态）
// convertParams // 请求参数装换器（每次执行请求前转换传入的参数）
// convertData // 数据装换器（成功请求后转换原始响应或经extractData提取的数据并设置到data状态）
// onFinish // 请求完成钩子（首次请求成功后调用传入的回调）
// onSuccess // 请求成功钩子（请求成功后调用钩子传入的回调）
// immediate // 立即执行请求（使用请求hook后立即执行请求）
// initialData // 初始数据（data的初始数据）

// useRequestWrap提供以下状态：
// isLoading // 是否正在请求（请求中为true，请求结束为false）
// isFinished // 是否已完成请求（请求成功执行一次后为true）
// isAborted // 是否已取消请求（当前请求请求被abort后为true，每次执行请求前重置为false）
// response // 请求原始响应（未经任何转换的原始响应数据）
// data // 请求数据（由一些配置参数传入的方法转换原始响应后的数据，如提取原始响应数据中的业务数据、如转换原始数据成预期结构等）
// error // 错误信息（当前请求发生错误时的错误信息，每次执行请求前重置为false）
// execute // 请求执行方法（提供手动执行请求的方法，且可以重新传递请求参数）
// abort // 请求终止方法（终止当前请求）
// reset // 重置请求（重置请求的各状态如：data、isFinished...，为初始状态，且会终止当前状态）
// then // 同promise
// catch // 同promise
// finally // 同promise

import { ref, shallowRef, watch, type Ref, toValue } from "vue";

// createUseRequest选项
interface CreateOptions<T> {
  // abortToken?: () => any; // 请求取消令牌
  dataExtract?: (data: T) => any; // 业务数据提取(传入后data类型将推断为any,需要在useRequest时手动传入泛型以收窄data实类型)
}

// useRequest request参数类型
interface Request<P extends any[] = any[], R = any> {
  (...arg: P): Promise<R>;
}

// useRequest选项
interface BaseOptions<P, CP, R, ED, I extends boolean> {
  convertParams?: (params: P) => CP; // 转换请求前的params
  convertData?: (data: R) => ED; // 转换请求后的data
  onFinish?: (data: ED) => void; // 首次请求后回调
  onSuccess?: (data: ED) => void; // 失败回调
  immediate?: I; // 立即执行请求
  initialData?: ED; // 默认data值
  deep?: boolean; // 深监控
}

// useApi选项
type Options<P, CP, R, ED> = {
  convertParams?: (params: P) => CP; // 转换请求前的params
  convertData?: (data: R) => ED; // 转换请求后的data
  onFinish?: (data: ED) => void; // 首次请求后回调
  onSuccess?: (data: ED) => void; // 失败回调
  immediate?: boolean; // 立即执行请求
  initialData?: ED; // 默认data值（此选项将覆盖useRequest选项中的同名选项）
  deep?: boolean; // 深监控（此选项将覆盖useRequest选项中的同名选项）
};

/**
 * 创建使用请求
 * @genericity CO createOptions实参
 * @genericity RS 公共响应结构(自动推断)
 * @param createOptions
 */
export function createUseRequest<
  CO extends CreateOptions<RS>,
  RS = CO extends CreateOptions<infer T> ? T : any,
>(createOptions?: CO) {
  /**
   * 使用请求
   * @notes 上层传入dataExtract后导致data类型推导失效，需要全量传入泛型实参
   * @genericity P 请求参数
   * @genericity R 请求响应
   * @genericity D data数据类型（上层传入dataExtract后将推导为any）
   * @param request
   */
  function useRequest<
    P extends any[],
    R extends RS,
    D extends CO extends Required<Pick<CreateOptions<RS>, "dataExtract">>
      ? any
      : R,
  >(request: Request<P, R>) {
    /**
     * 接收使用请求的选项
     * 因ts类型推断实现问题，所以将选项放入内层函数传入
     * @genericity I 二级选项immediate实际值类型
     * @genericity AP 二级选项convertParams实际参数类型
     * @genericity AD 二级选项convertData实际返回类型
     * @genericity RP 第二级函数需要的参数类型
     * @genericity RD 第二级函数返回的Data类型
     * @param baseOptions
     */
    let isTopFinished = false;
    function useBaseOptions<
      I extends boolean,
      AP,
      AD,
      RP extends unknown extends AP ? P : AP,
      RD extends unknown extends AD ? D : AD,
    >(baseOptions?: BaseOptions<AP, P, D, AD, I>) {
      /**
       * 使用API
       * @genericity CP 实际传入请求参数
       * @param params
       * 使用参数集合元组类型方式定义参数则CP泛型推断永远为unknown，所以采用多一层useOptions方式传入选项
       */
      function useApi<CP>(
        params?: CP | RP | Ref<CP> | Ref<RP> | (() => CP | RP)
      ) {
        /**
         * 接收使用API的选项
         * 因ts类型推断实现问题，所以将选项放入内层函数传入
         * @genericity AAD 第三级选项convertData实际返回类型
         * @genericity RRD 第三级函数返回的Data类型(最终Data类型)
         * @genericity OO 实际传入的选项类型
         * @param arg.options 上层选项传入立即执行时，且参数类型满足上层要求则：参数可选，参数不满足上层要求时必须传入不立即执行immediate:false，或者传入参数转换方法convertParams
         * 上层选项未指定立即执行时，且参数类型满足上层要求则：参数可选，参数不满足上层要求时，如果传入immediate:true则convertParams必传
         */
        function useOptions<
          AAD,
          RRD extends unknown extends AAD ? RD : AAD,
          OO extends Options<CP, RP, RD, AAD>,
        >(
          ...arg: I extends true
            ? CP extends RP
              ? [options?: Options<CP, RP, RD, AAD> & OO]
              : [
                  options:
                    | (Options<CP, RP, RD, AAD> & OO & { immediate: false })
                    | (Options<CP, RP, RD, AAD> &
                        OO & {
                          convertParams: (params: CP) => RP;
                        }),
                ]
            : [
                options?: CP extends RP
                  ? Options<CP, RP, RD, AAD> & OO
                  :
                      | (Options<CP, RP, RD, AAD> & OO & { immediate?: false })
                      | (Options<CP, RP, RD, AAD> &
                          OO & {
                            convertParams: (params: CP) => RP;
                          }),
              ]
        ) {
          const options = arg[0];
          const { immediate = false, deep = true } = {
            ...baseOptions,
            ...options,
          };
          const isLoading = ref(false);
          const isFinished = ref(false);
          // const isAborted = ref(false);
          const response = shallowRef<R | undefined>(undefined);
          const data = ref<RRD | undefined>();
          const error = shallowRef<Error | undefined>(undefined);

          /**
           * 自定义promise，合并自定义对象到promise上，且返回的新promise都默认附带这个对象的属性
           * @param promise
           * @param object
           */
          const customPromise = <T, S extends Record<string, any>>(
            promise: Promise<T>,
            object: S
          ) => ({
            then: <TResult1 = T, TResult2 = never>(
              onfulfilled?:
                | ((value: T) => TResult1 | PromiseLike<TResult1>)
                | undefined
                | null,
              onrejected?:
                | ((reason: any) => TResult2 | PromiseLike<TResult2>)
                | undefined
                | null
            ) =>
              customPromise(
                promise.then(onfulfilled, onrejected) as Promise<
                  TResult1 | TResult2
                >,
                object
              ),
            catch: <TResult = never>(
              onrejected?:
                | ((reason: any) => TResult | PromiseLike<TResult>)
                | undefined
                | null
            ) =>
              customPromise(
                promise.catch(onrejected) as Promise<T | TResult>,
                object
              ),
            finally: (onfinally?: (() => void) | undefined | null) =>
              customPromise(promise.finally(onfinally) as Promise<T>, object),
            ...object,
          });

          /**
           * 终止请求
           * @param msg 终止信息
           */
          // const abort = (msg: string) => {}

          /**
           * 执行请求
           * @param arg.params 上层未传入有效参数时必传要求的参数
           */
          const execute = (
            ...arg: OO extends { convertParams: (params: infer T) => any }
              ? [params?: T | Ref<T>]
              : CP extends RP
                ? [params?: RP | Ref<RP>]
                : [params: RP | Ref<RP>]
          ) => {
            const p1 = toValue(arg[0] ?? params);
            const p2 = options?.convertParams?.(p1 as CP) ?? p1;
            const p3 = baseOptions?.convertParams?.(p2 as AP) ?? p2;

            isLoading.value = true;

            const resultOrigin = request(...(p3 as P));
            const result = customPromise(resultOrigin, returnObj);

            result.then(originalResponse => {
              const data =
                createOptions?.dataExtract?.(originalResponse) ??
                originalResponse;
              const data2 = baseOptions?.convertData?.(data) ?? data;
              const data3 = options?.convertData?.(data2) ?? data2;

              if (!isFinished.value) {
                options?.onFinish?.(data3);
              }

              if (!isTopFinished) {
                baseOptions?.onFinish?.(data2);
              }

              baseOptions?.onSuccess?.(data2);
              options?.onSuccess?.(data3);

              response.value = originalResponse;
              data.value = data3;
              isTopFinished = isFinished.value = true;
            });

            result.catch(e => {
              if (e in Error) {
                error.value = e;
              } else {
                error.value = new Error(e);
              }
            });

            result.finally(() => {
              isLoading.value = false;
            });

            return result;
          };

          const returnObj = {
            isLoading,
            isFinished,
            // isAborted,
            response,
            data,
            error,
            execute,
          };

          if (!!params) {
            watch(params, () => execute, {
              deep,
              immediate,
            });
          }

          if (options?.initialData) {
            data.value = options.initialData as RRD;
          } else if (baseOptions?.initialData) {
            data.value = options?.convertData
              ? (options.convertData(
                  baseOptions.initialData as RD
                ) as unknown as RRD)
              : (baseOptions.initialData as RRD);
          }

          return immediate
            ? execute(...([params] as Parameters<typeof execute>))
            : { ...returnObj, execute };
        }

        return useOptions;
      }

      return useApi;
    }

    return useBaseOptions;
  }

  return useRequest;
}
