import useUserApi from './useUserApi';

const useUser = (userId?: string) => {
  const { getUser } = useUserApi();

  const { data, isLoading, error } = getUser(userId);

  return {
    user: data ?? null,
    isLoading,
    isError: !!error,
  };
};

export default useUser;
