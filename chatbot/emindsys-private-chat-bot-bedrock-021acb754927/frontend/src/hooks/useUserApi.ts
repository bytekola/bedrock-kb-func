import {
  GetUserResponse,
  SearchUserGroupsRequest,
  SearchUserGroupsResponse,
  SearchUsersRequest,
  SearchUsersResponse,
} from '../@types/user';
import useHttp from './useHttp';

const useUserApi = () => {
  const http = useHttp();

  return {
    searchUsers: (prefix?: string) => {
      const res: SearchUsersRequest = {
        prefix: prefix ?? '',
      };
      return http.get<SearchUsersResponse>(
        prefix ? ['user/search', res] : null
      );
    },
    searchUserGroups: (prefix?: string) => {
      const res: SearchUserGroupsRequest = {
        prefix: prefix ?? '',
      };
      return http.get<SearchUserGroupsResponse>(
        prefix ? ['user/group/search', res] : null
      );
    },
    getUser: (userId?: string) => {
      return http.get<GetUserResponse>(userId ? `user/${userId}` : null);
    },
  };
};

export default useUserApi;
