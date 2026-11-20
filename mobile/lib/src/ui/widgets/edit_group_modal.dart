import 'package:flutter/material.dart';

import '../../models/models.dart';
import '../../utils/group_meta.dart';

/// Dialog for editing a group's name and description (spec A).
class EditGroupModal extends StatefulWidget {
  const EditGroupModal({
    super.key,
    required this.group,
    required this.onSave,
    required this.onClose,
  });

  final GroupInfo group;
  final void Function(String name, String description) onSave;
  final VoidCallback onClose;

  @override
  State<EditGroupModal> createState() => _EditGroupModalState();
}

class _EditGroupModalState extends State<EditGroupModal> {
  late final TextEditingController _nameController =
      TextEditingController(text: widget.group.name);
  late final TextEditingController _descriptionController =
      TextEditingController(text: widget.group.description);

  @override
  void dispose() {
    _nameController.dispose();
    _descriptionController.dispose();
    super.dispose();
  }

  bool get _canSave => canSaveGroupEdit(
        _nameController.text,
        _descriptionController.text,
      );

  void _save() {
    if (!_canSave) return;
    widget.onSave(_nameController.text, _descriptionController.text);
  }

  @override
  Widget build(BuildContext context) {
    return AlertDialog(
      title: const Text('Edit group'),
      content: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          TextField(
            controller: _nameController,
            onChanged: (_) => setState(() {}),
            maxLength: maxGroupNameLength,
            decoration: const InputDecoration(labelText: 'Group name'),
          ),
          const SizedBox(height: 8),
          TextField(
            controller: _descriptionController,
            onChanged: (_) => setState(() {}),
            maxLength: maxGroupDescriptionLength,
            maxLines: 3,
            decoration: const InputDecoration(labelText: 'Description'),
          ),
        ],
      ),
      actions: [
        TextButton(
          onPressed: widget.onClose,
          child: const Text('Cancel'),
        ),
        ElevatedButton(
          onPressed: _canSave ? _save : null,
          child: const Text('Save'),
        ),
      ],
    );
  }
}

/// Shows the edit-group dialog.
Future<void> showEditGroupModal(
  BuildContext context, {
  required GroupInfo group,
  required void Function(String name, String description) onSave,
}) async {
  await showDialog<void>(
    context: context,
    builder: (dialogContext) => EditGroupModal(
      group: group,
      onSave: (name, description) {
        onSave(name, description);
        Navigator.of(dialogContext).pop();
      },
      onClose: () => Navigator.of(dialogContext).pop(),
    ),
  );
}
