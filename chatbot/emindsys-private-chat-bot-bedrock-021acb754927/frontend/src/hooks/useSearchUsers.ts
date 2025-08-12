import { useMemo } from 'react';
import useUserApi from './useUserApi';
import { SearchedUser } from '../@types/user';

const useSearchUsers = (prefix: string) => {
  const { searchUsers, searchUserGroups } = useUserApi();

  const normalizedPrefix = prefix === '' ? undefined : prefix;

  const { data: users, isLoading: isLoadingUsers } =
    searchUsers(normalizedPrefix);

  const { data: userGroups, isLoading: isLoadingUserGroups } =
    searchUserGroups(normalizedPrefix);

  const searchedUsers = useMemo<SearchedUser[]>(() => {
    const users_: SearchedUser[] =
      users?.map((user) => ({
        type: 'user',
        ...user,
      })) ?? [];

    const userGroups_: SearchedUser[] =
      userGroups?.map((group) => ({
        type: 'group',
        ...group,
      })) ?? [];

    return users_
      .concat(userGroups_)
      .sort((a, b) => (a.name >= b.name ? 1 : -1));
  }, [users, userGroups]);

  const isLoading = useMemo(() => {
    return isLoadingUsers || isLoadingUserGroups;
  }, [isLoadingUsers, isLoadingUserGroups]);

  return {
    searchedUsers,
    isLoading,
  };
};

export default useSearchUsers;
