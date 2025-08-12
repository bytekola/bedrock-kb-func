import i18n from 'i18next';

export const getShareText = (userCount: number, groupCount: number): string => {
  // both zero
  if (userCount === 0 && groupCount === 0) {
    return i18n.t('bot.shareDialog.label.sharing.not_shared');
  }

  // both
  if (userCount > 0 && groupCount > 0) {
    if (userCount > 1 && groupCount > 1) {
      return i18n.t('bot.shareDialog.label.sharing.shared_both', {
        userCount,
        groupCount,
      });
    } else if (userCount > 1) {
      return i18n.t('bot.shareDialog.label.sharing.shared_both_user_plural', {
        userCount,
        groupCount,
      });
    } else if (groupCount > 1) {
      return i18n.t('bot.shareDialog.label.sharing.shared_both_group_plural', {
        userCount,
        groupCount,
      });
    } else {
      return i18n.t('bot.shareDialog.label.sharing.shared_both', {
        userCount,
        groupCount,
      });
    }
  }
  // only users
  if (userCount > 0) {
    return i18n.t('bot.shareDialog.label.sharing.shared_only_users', {
      count: userCount,
    });
  }

  // only groups
  return i18n.t('bot.shareDialog.label.sharing.shared_only_groups', {
    count: groupCount,
  });
};
