// 페이지를 나눠 읽어도 순서가 안정되도록 ID로 정렬한다.
export const RESOURCES_QUERY: string = `resources
| project id, name, type, kind, location, resourceGroup, subscriptionId, sku, tags, zones, managedBy, properties
| order by id asc`;

export const CONTAINERS_QUERY: string = `resourcecontainers
| where type in~ ('microsoft.resources/subscriptions', 'microsoft.resources/subscriptions/resourcegroups')
| project id, name, type, location, subscriptionId, resourceGroup, tags
| order by id asc`;
